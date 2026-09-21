import type { SnapshotTransition } from './document-positions';
import type { NodeIdentity } from './schema';
import type { EditorState, Transaction } from './transactions';

export type ExtensionUpdate<N extends NodeIdentity> = {
  before: EditorState<N>;
  after: EditorState<N>;
} & (
  | { kind: 'transaction'; transaction: Transaction<N>; mapping: SnapshotTransition<N> }
  | { kind: 'undo' | 'redo'; mapping: SnapshotTransition<N> }
  | { kind: 'selection' | 'storedMarks' }
);

export type StateFieldRegistration<N extends NodeIdentity> = {
  initialize(state: EditorState<N>): void;
  prepare(update: ExtensionUpdate<N>): void;
};

/** Typed plugin state belongs to session snapshots, never to schema nodes.
 * Reducers are pure and run before publication; a thrown error aborts the update.
 */
export function createStateField<N extends NodeIdentity, Value>(spec: {
  create: (state: EditorState<N>) => Value;
  update: (value: Value, event: ExtensionUpdate<N>) => Value;
}) {
  const values = new WeakMap<EditorState<N>, { value: Value }>();

  function read(state: EditorState<N>): Value {
    const entry = values.get(state);

    if (!entry) throw new Error('State field is not registered with this editor snapshot');

    return entry.value;
  }

  return Object.freeze({
    read,
    initialize(state: EditorState<N>) {
      values.set(state, { value: spec.create(state) });
    },
    prepare(event: ExtensionUpdate<N>) {
      values.set(event.after, { value: spec.update(read(event.before), event) });
    },
  });
}
