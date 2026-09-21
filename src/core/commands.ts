import type { NodeIdentity } from '../model';
import type { CommandDefinition, CommandState, createEditor, CommandOptions } from '../state';

export type CommandDefinitions<N extends NodeIdentity> = Readonly<
  Record<string, CommandDefinition<N, never[]>>
>;

type Arguments<Definition> = [Definition] extends [never]
  ? never[]
  : Definition extends {
        execute: (context: never, ...args: infer Args) => boolean;
      }
    ? Args
    : never;

export type DirectCommands<Definitions> = {
  readonly [Name in keyof Definitions]: (...args: Arguments<Definitions[Name]>) => boolean;
};

export type CommandStateQuery<Definitions> = keyof Definitions extends never
  ? (name: never, ...args: never[]) => CommandState
  : <Name extends keyof Definitions>(
      name: Name,
      ...args: Arguments<Definitions[Name]>
    ) => CommandState;

export type NamedChain<Definitions> = {
  readonly [Name in keyof Definitions]: (
    ...args: Arguments<Definitions[Name]>
  ) => NamedChain<Definitions>;
} & { run(): boolean };

type StateEditor<N extends NodeIdentity> = ReturnType<typeof createEditor<N>>;

/** Named invocation and dry runs share the imperative draft implementation. */
export function commandRegistry<N extends NodeIdentity>(
  editor: StateEditor<N>,
  contributions: readonly { name: string; commands?: CommandDefinitions<N> }[],
) {
  const commands = new Map<string, CommandDefinition<N, never[]>>();
  const owners = new Map<string, string>();

  for (const contribution of contributions) {
    for (const [name, command] of Object.entries(contribution.commands ?? {})) {
      if (!name || name === 'run' || name === 'chain' || name === 'then')
        throw new Error(`Reserved command name: ${name}`);

      if (commands.has(name))
        throw new Error(`Duplicate command ${name}: ${owners.get(name)} and ${contribution.name}`);
      commands.set(name, Object.freeze({ ...command }));
      owners.set(name, contribution.name);
    }
  }

  function chain(dryRun = false, options?: CommandOptions) {
    const draft = dryRun ? editor.can(options) : editor.chain(options);

    const named = Object.fromEntries(
      [...commands].map(([name, command]) => [
        name,
        (...args: never[]) => {
          draft.command(command, ...args);

          return named;
        },
      ]),
    );

    return Object.freeze(Object.assign(named, { run: () => draft.run() }));
  }

  function direct(dryRun = false) {
    return Object.freeze(
      Object.fromEntries(
        [...commands].map(([name, command]) => [
          name,
          (...args: never[]) =>
            (dryRun ? editor.can() : editor.chain()).command(command, ...args).run(),
        ]),
      ),
    );
  }

  function state(name: string, ...args: never[]): CommandState {
    const command = commands.get(name);

    if (!command) throw new Error(`Unknown command: ${name}`);

    return editor.commandState(command, ...args);
  }

  return { direct, chain, state };
}
