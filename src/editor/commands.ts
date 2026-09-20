import type {NodeIdentity} from './schema';
import type {EditorState, Step, Transaction} from './transactions';
import type {Selection} from './selection';
import {PermissionDenied} from './permissions';

export type CommandContext<N extends NodeIdentity> = {
  readonly state: EditorState<N>;
  step(step: Step<N>): void;
  steps(steps: readonly Step<N>[]): void;
  select(selection: Selection): void;
};
export type Command<N extends NodeIdentity, Args extends unknown[] = []> = (context: CommandContext<N>, ...args: Args) => boolean;
type Host<N extends NodeIdentity> = {
  readonly state: EditorState<N>;
  preview(state: EditorState<N>, tx: Transaction<N>): EditorState<N>;
  dispatch(tx: Transaction<N>): unknown;
};
/** Commands see preceding commands' draft state; only run publishes one transaction. */
export function createCommandChain<N extends NodeIdentity>(host: Host<N>, dryRun = false) {
  const initial = host.state, steps: Step<N>[] = [];
  let draft = initial, enabled = true, finished = false;
  function open() {if (finished) throw new Error('Command chain already completed');}
  const chain = {
    get state() {return draft;},
    step(step: Step<N>) {return chain.steps([step]);},
    steps(batch: readonly Step<N>[]) {
      open(); if (!enabled) return chain;
      try {
        draft = host.preview(draft, {baseRevision: draft.revision, origin: 'local', history: 'separate', time: 0, steps: [...batch]});
        for (const step of batch) steps.push(step);
      } catch (error) {if (error instanceof PermissionDenied) enabled = false; else throw error;}
      return chain;
    },
    select(selection: Selection) {
      open(); if (!enabled) return chain;
      draft = host.preview(draft, {baseRevision: draft.revision, origin: 'local', history: 'separate', time: 0, steps: [], selection});
      return chain;
    },
    command<Args extends unknown[]>(command: Command<N, Args>, ...args: Args) {
      open(); if (enabled && !command(chain, ...args)) enabled = false;
      return chain;
    },
    run() {
      open(); finished = true;
      if (!enabled || host.state !== initial) return false;
      const tx: Transaction<N> = {baseRevision: initial.revision, origin: 'local', history: 'separate', time: Date.now(), steps, selection: draft.selection};
      try {
        if (dryRun) host.preview(initial, tx);
        else if (steps.length || !draft.selection.eq(initial.selection)) host.dispatch(tx);
        return true;
      } catch (error) {if (error instanceof PermissionDenied) return false; throw error;}
    },
  };
  return chain;
}
