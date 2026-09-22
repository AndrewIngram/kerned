import type { NodeIdentity } from '@gprose/model';
import type { CommandActivity, CommandContext, ReadContext } from '@gprose/state';

/** Reusable commands operate on the executing document, not one closed node union. */
export function defineCommand<Args extends unknown[]>(definition: {
  execute: <N extends NodeIdentity>(context: CommandContext<N>, ...args: Args) => boolean;
  activity?: <N extends NodeIdentity>(context: ReadContext<N>, ...args: Args) => CommandActivity;
}) {
  return Object.freeze({ ...definition });
}

/** Pure document queries reuse results for an immutable state snapshot and primitive arguments.
 * Object/function arguments remain uncached because their contents can change independently.
 */
export function defineQuery<Args extends unknown[], Value>(
  query: <N extends NodeIdentity>(context: ReadContext<N>, ...args: Args) => Value,
) {
  const snapshots = new WeakMap<
    object,
    { schema: object; entries: { args: Args; value: Value }[] }
  >();

  return <N extends NodeIdentity>(context: ReadContext<N>, ...args: Args): Value => {
    const mutable = args.some((value) => {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Query arguments are already typed by the extension; this detects mutable identity for cache eligibility, not input validation.
      return value !== null && (typeof value === 'object' || typeof value === 'function');
    });

    if (mutable) return query(context, ...args);
    let cached = snapshots.get(context.state);

    if (cached?.schema !== context.schema) {
      cached = { schema: context.schema, entries: [] };
      snapshots.set(context.state, cached);
    }

    const entry = cached.entries.find(
      (entry) =>
        entry.args.length === args.length &&
        args.every((value, index) => Object.is(value, entry.args[index])),
    );

    if (entry) return entry.value;
    const value = query(context, ...args);
    cached.entries.push({ args, value });

    if (cached.entries.length > 16) cached.entries.shift();

    return value;
  };
}

/** Type-only argument binding for commands that consume canonical document nodes. */
export interface DocumentCommandArguments {
  readonly node: unknown;
  readonly args: unknown[];
}

type BoundArguments<Args extends DocumentCommandArguments, N extends NodeIdentity> = (Args & {
  readonly node: N;
})['args'];

declare const documentArguments: unique symbol;

export type DocumentCommandDefinition<Args extends DocumentCommandArguments> = {
  readonly [documentArguments]?: Args;
  execute: <N extends NodeIdentity>(
    context: CommandContext<N>,
    ...args: BoundArguments<Args, N>
  ) => boolean;
  activity?: <N extends NodeIdentity>(
    context: ReadContext<N>,
    ...args: BoundArguments<Args, N>
  ) => CommandActivity;
};

/** Only node-dependent arguments need an explicit binding; ordinary arguments use defineCommand. */
export function defineDocumentCommand<Args extends DocumentCommandArguments>(
  definition: DocumentCommandDefinition<Args>,
): DocumentCommandDefinition<Args> {
  return Object.freeze({ ...definition });
}

export type CommandArguments<Definition, N extends NodeIdentity> = [Definition] extends [never]
  ? never[]
  : typeof documentArguments extends keyof Definition
    ? Definition extends DocumentCommandDefinition<infer Args>
      ? BoundArguments<Args, N>
      : never
    : Definition extends { execute: (context: never, ...args: infer Args) => boolean }
      ? Args
      : never;
