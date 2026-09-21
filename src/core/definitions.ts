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
