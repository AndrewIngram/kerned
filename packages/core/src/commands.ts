import type { NodeIdentity } from '@gprose/model';
import type { CommandDefinition, CommandState, createEditor, CommandOptions } from '@gprose/state';

import type { CommandArguments } from './definitions.js';
import type { ViewCommands } from './view-effects.js';

export type CommandDefinitions<N extends NodeIdentity> = Readonly<
  Record<string, CommandDefinition<N, never[]>>
>;

export type DirectCommands<Definitions, N extends NodeIdentity> = {
  readonly [Name in keyof Definitions]: (
    ...args: CommandArguments<Definitions[Name], N>
  ) => boolean;
};

export type CommandStateQuery<Definitions, N extends NodeIdentity> = (
  ...request: {
    [Name in keyof Definitions]: [name: Name, ...args: CommandArguments<Definitions[Name], N>];
  }[keyof Definitions]
) => CommandState;

export type NamedChain<Definitions, N extends NodeIdentity> = {
  readonly [Name in keyof Definitions]: (
    ...args: CommandArguments<Definitions[Name], N>
  ) => NamedChain<Definitions, N>;
} & { run(): boolean };

type StateEditor<N extends NodeIdentity> = ReturnType<typeof createEditor<N>>;

/** Named invocation and dry runs share the imperative draft implementation. */
export function commandRegistry<N extends NodeIdentity>(
  editor: StateEditor<N>,
  contributions: readonly { name: string; commands?: CommandDefinitions<N> }[],
  viewCommands: ViewCommands,
) {
  const commands = new Map<string, CommandDefinition<N, never[]>>();
  const owners = new Map<string, string>();

  for (const contribution of [{ name: 'editorView', commands: viewCommands }, ...contributions]) {
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

    function queue(command: CommandDefinition<N, never[]>, args: never[] = []) {
      draft.command(command, ...args);

      return named;
    }

    const named: NamedChain<ViewCommands, N> = Object.freeze(
      Object.assign(
        Object.fromEntries(
          [...commands].map(([name, command]) => [
            name,
            (...args: never[]) => queue(command, args),
          ]),
        ),
        {
          focus: () => queue(viewCommands.focus),
          scrollIntoView: () => queue(viewCommands.scrollIntoView),
          run: () => draft.run(),
        },
      ),
    );

    return named;
  }

  function direct(dryRun = false) {
    function invoke(command: CommandDefinition<N, never[]>, args: never[] = []) {
      return (dryRun ? editor.can() : editor.chain()).command(command, ...args).run();
    }

    return Object.freeze(
      Object.assign(
        Object.fromEntries(
          [...commands].map(([name, command]) => [
            name,
            (...args: never[]) => invoke(command, args),
          ]),
        ),
        {
          focus: () => invoke(viewCommands.focus),
          scrollIntoView: () => invoke(viewCommands.scrollIntoView),
        },
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
