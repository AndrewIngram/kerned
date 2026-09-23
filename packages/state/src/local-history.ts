import type { Mark, NodeIdentity } from '@kerned/model';
import {
  invertAnchorMap,
  invertPositionMap,
  restoreChanges,
  type AnchorMap,
  type DocumentChange,
  type PositionMap,
} from '@kerned/transform';

import type { MappingOperation } from './relative-positions.js';
import type { Selection } from './selection-base.js';
import type { SelectionBookmark } from './selection.js';
import type { EditorState, Transaction } from './transactions.js';

type Entry<N extends NodeIdentity> = {
  changes: DocumentChange<N>[];
  maps: AnchorMap[];
  positionMaps: PositionMap[];
  operations: MappingOperation[];
  before: SelectionBookmark;
  after: SelectionBookmark;
  afterSelection: Selection;
  group: string | null;
  time: number;
  beforeMarks: readonly Mark[] | null;
  afterMarks: readonly Mark[] | null;
};

type HistoryEdit<N extends NodeIdentity> = {
  before: EditorState<N>;
  after: EditorState<N>;
  transaction: Extract<Transaction<N>, { origin: 'local' }>;
  changes: readonly DocumentChange<N>[];
  maps: readonly PositionMap[];
  anchorMaps: readonly AnchorMap[];
  operations: readonly MappingOperation[];
};

/** Local undo retention and grouping. The owning extension supplies this policy. */
export type HistoryOptions = {
  readonly depth?: number;
  readonly newGroupDelay?: number;
};

/** Consecutive snapshots of the same roots only need the group's endpoints.
 * Position maps remain separate: external references can originate between edits. */
function appendChanges<N extends NodeIdentity>(
  target: DocumentChange<N>[],
  incoming: readonly DocumentChange<N>[],
) {
  for (const change of incoming) {
    const last = target.at(-1);

    if (
      last &&
      last.index === change.index &&
      last.after.length === change.before.length &&
      last.before.length === change.after.length &&
      last.after.every((node, index) => node === change.before[index]) &&
      last.before.every(
        (node, index) => node.id === change.after[index].id && node.key === change.after[index].key,
      )
    ) {
      // Replace the record; transform results may also be held by subscribers.
      target[target.length - 1] = { index: last.index, before: last.before, after: change.after };
    } else target.push(change);
  }
}

/** Own grouping and retained edits; preparing a replay never mutates history. */
export function createLocalHistory<N extends NodeIdentity>(options: HistoryOptions = {}) {
  const depth = options.depth ?? 256;
  const newGroupDelay = options.newGroupDelay ?? 750;

  if (!Number.isSafeInteger(depth) || depth < 1)
    throw new Error('History depth must be a positive integer');

  if (!Number.isFinite(newGroupDelay) || newGroupDelay < 0)
    throw new Error('History group delay must be nonnegative');
  const past: Entry<N>[] = [];
  const future: Entry<N>[] = [];
  let boundary = true;
  let version = 0;

  return {
    get counts() {
      return { undo: past.length, redo: future.length };
    },
    closeGroup() {
      boundary = true;
      version++;
    },
    clear() {
      past.length = 0;
      future.length = 0;
      boundary = true;
      version++;
    },
    record(edit: HistoryEdit<N>) {
      if (!edit.changes.length) return;
      const { before, after, transaction: tx } = edit;
      const group = tx.history === 'separate' ? null : tx.history.group;
      const last = past.at(-1);

      if (
        !boundary &&
        group !== null &&
        last?.group === group &&
        tx.time >= last.time &&
        (group.startsWith('composition:') || tx.time - last.time < newGroupDelay) &&
        last.afterSelection.eq(before.selection)
      ) {
        appendChanges(last.changes, edit.changes);
        last.maps.push(...edit.anchorMaps);
        last.positionMaps.push(...edit.maps);
        last.operations.push(...edit.operations);
        last.after = after.selection.getBookmark();
        last.afterSelection = after.selection;
        last.afterMarks = after.storedMarks ?? null;
        last.time = tx.time;
      } else {
        const changes: DocumentChange<N>[] = [];
        appendChanges(changes, edit.changes);
        past.push({
          changes,
          maps: [...edit.anchorMaps],
          positionMaps: [...edit.maps],
          operations: [...edit.operations],
          before: before.selection.getBookmark(),
          after: after.selection.getBookmark(),
          afterSelection: after.selection,
          beforeMarks: before.storedMarks ?? null,
          afterMarks: after.storedMarks ?? null,
          group,
          time: tx.time,
        });

        if (past.length > depth) past.shift();
      }

      future.length = 0;
      boundary = group === null;
      version++;
    },
    prepare(nodes: readonly N[], direction: 'undo' | 'redo') {
      const redo = direction === 'redo';
      const source = redo ? future : past;
      const target = redo ? past : future;
      const entry = source.at(-1);

      if (!entry) return null;
      const preparedAt = version;
      const restored = restoreChanges(nodes, entry.changes, redo ? 'forward' : 'backward');

      return {
        ...restored,
        selection: redo ? entry.after : entry.before,
        storedMarks: redo ? entry.afterMarks : entry.beforeMarks,
        maps: redo ? entry.maps : entry.maps.toReversed().map(invertAnchorMap),
        positionMaps: redo
          ? entry.positionMaps
          : entry.positionMaps.toReversed().map(invertPositionMap),
        operations: entry.operations,
        isCurrent: () => version === preparedAt,
        commit() {
          if (version !== preparedAt) throw new Error('History changed after replay was prepared');
          source.pop();
          target.push(entry);
          boundary = true;
          version++;
        },
      };
    },
  };
}
