import type { NodeIdentity } from '../model';
import type { CommandActivity, CommandContext, ReadContext } from '../state';

/** Reusable commands operate on the executing document, not one closed node union. */
export function defineCommand<Args extends unknown[]>(definition: {
  execute: <N extends NodeIdentity>(context: CommandContext<N>, ...args: Args) => boolean;
  activity?: <N extends NodeIdentity>(context: ReadContext<N>, ...args: Args) => CommandActivity;
}) {
  return Object.freeze({ ...definition });
}

/** Contextual typing keeps query authors independent of a consumer's document types. */
export function defineQuery<Args extends unknown[], Value>(
  query: <N extends NodeIdentity>(context: ReadContext<N>, ...args: Args) => Value,
) {
  return query;
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
