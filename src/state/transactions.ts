import {
  type Mark,
  type NodeIdentity,
  type Schema,
  type JsonValue,
  indexTree,
  validateTree,
} from '../model';
import {
  invertAnchorMap,
  type AnchorMap,
  type RevisionMap,
  type SnapshotTransition,
  invertPositionMap,
  type PositionMap,
  applySteps,
  restoreChanges,
  type DocumentChange,
  type Step,
} from '../transform';
import { createCommandChain, type CommandDefinition, type CommandState } from './commands';
import type { StateFieldRegistration, ExtensionUpdate } from './extension-state';
import { createFind } from './find';
import { assertEditAllowed, assertContentEditAllowed, type AccessPolicy } from './permissions';
import {
  createRelativePositions,
  parsePositionCheckpoint,
  type MappingOperation,
} from './relative-positions';
import {
  TextSelection,
  selectionContext,
  selectionMapping,
  createSelectionRegistry,
  type SelectionExtension,
  type SelectionBookmark,
} from './selection';
import { Selection } from './selection-base';
import { inputMarks } from './stored-marks';

export type Transaction<N extends NodeIdentity> = {
  baseRevision: number;
  steps: readonly Step<N>[];
  selection?: Selection;
  input?: boolean;
  storedMarks?: readonly Mark[] | null;
} & (
  | { origin: 'local'; history: 'separate' | { group: string }; time: number }
  | { origin: 'stream'; history: 'exclude' }
);

export type EditorState<N extends NodeIdentity> = {
  nodes: N[];
  selection: Selection;
  revision: number;
  storedMarks?: readonly Mark[] | null;
};

type Applied<N extends NodeIdentity> = {
  state: EditorState<N>;
  changes: DocumentChange<N>[];
  maps: PositionMap[];
  anchorMaps: AnchorMap[];
  changedIds: number[];
  positionMapping: SnapshotTransition<N>;
};

type HistoryEntry<N extends NodeIdentity> = {
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

export type EditorOptions<N extends NodeIdentity = NodeIdentity> = {
  documentId?: string;
  revision?: number;
  positionCheckpoint?: unknown;
  permissions?: AccessPolicy<N>;
  fields?: readonly StateFieldRegistration<N>[];
};

export function applyTransaction<N extends NodeIdentity>(
  schema: Schema<N>,
  state: EditorState<N>,
  tx: Transaction<N>,
  selections = createSelectionRegistry(),
  permissions?: AccessPolicy<N>,
): Applied<N> {
  if (tx.baseRevision !== state.revision)
    throw new Error('Stale transaction: rebase before applying');

  for (const step of tx.steps) {
    if (tx.origin === 'stream' && step.kind !== 'append')
      throw new Error('Stream transactions may only append blocks');

    if (tx.origin !== 'stream' && step.kind === 'append')
      throw new Error('Append belongs to the loading stream');
  }

  const beforeTree = indexTree(schema, state.nodes);

  const typingMarks =
    tx.origin === 'local' && tx.input ? inputMarks(schema, state, beforeTree) : undefined;

  const result = applySteps(schema, state.nodes, tx.steps, {
    insertedMarks: typingMarks,
    beforeStep: permissions
      ? (nodes, step) => assertContentEditAllowed(schema, nodes, step, permissions)
      : undefined,
  });

  const { nodes, tree, changes, maps, anchorMaps, changedIds } = result;
  const context = selectionContext(schema, nodes, tree);

  const selection =
    tx.selection ??
    state.selection.map(
      context,
      selectionMapping(selectionContext(schema, state.nodes, beforeTree), context, maps),
    );

  selections.validate(context, selection);

  if (permissions) assertEditAllowed(schema, state.nodes, nodes, permissions);

  const caret =
    selection instanceof TextSelection &&
    selection.anchor.id === selection.head.id &&
    selection.anchor.offset === selection.head.offset;

  let storedMarks = caret
    ? (typingMarks ?? (state.selection.eq(selection) ? (state.storedMarks ?? null) : null))
    : null;

  if (tx.storedMarks !== undefined) {
    if (!caret || !(selection instanceof TextSelection))
      throw new Error('Stored marks require a caret');

    const node = tree.byId.get(selection.head.id)?.node,
      adapter = node ? schema.editing(node).marks : undefined;

    if (!node || !adapter) throw new Error('Text does not support marks');

    if (permissions)
      assertContentEditAllowed(
        schema,
        nodes,
        {
          kind: 'replaceText',
          id: node.id,
          from: selection.head.offset,
          to: selection.head.offset,
          text: '',
        },
        permissions,
      );

    const checked =
      tx.storedMarks === null ? null : (adapter.validate?.(tx.storedMarks) ?? tx.storedMarks);

    if (checked && new Set(checked.map((mark) => mark.type)).size !== checked.length)
      throw new Error('Duplicate stored mark type');
    storedMarks = checked === null ? null : structuredClone(checked);
  }

  const next = { nodes, selection, revision: state.revision + 1, storedMarks };

  return {
    state: next,
    changes,
    maps,
    anchorMaps,
    changedIds,
    positionMapping: { before: state, after: next, maps },
  };
}

function notifyListener(listener: () => void) {
  try {
    listener();
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
  }
}

/** Local history only. A collaboration adapter must rebase operations and history;
 * stale transactions are rejected rather than silently replayed over newer state. */
export function createEditor<N extends NodeIdentity>(
  schema: Schema<N>,
  initial: N[],
  selection: Selection,
  extensions: readonly SelectionExtension[] = [],
  options: EditorOptions<N> = {},
) {
  const selections = createSelectionRegistry(extensions);
  validateTree(schema, initial);
  selections.validate(selectionContext(schema, initial), selection);

  const documentId = options.documentId ?? crypto.randomUUID(),
    revision = options.revision ?? 0;

  if (!documentId || !Number.isSafeInteger(revision) || revision < 0)
    throw new Error('Invalid document identity or revision');

  let state: EditorState<N> = { nodes: initial, selection, revision, storedMarks: null },
    nextId = -1;

  let boundary = true;
  const fields = [...new Set(options.fields ?? [])];

  for (const field of fields) field.initialize(state);

  let preparing = false,
    publishing = false;

  function prepareFields(event: ExtensionUpdate<N>) {
    if (preparing) throw new Error('Extension reducers cannot change editor state');
    preparing = true;

    try {
      for (const field of fields) field.prepare(event);
    } finally {
      preparing = false;
    }
  }

  function assertWritable() {
    if (preparing) throw new Error('Extension reducers cannot change editor state');

    if (publishing) throw new Error('Editor subscribers cannot change state during publication');
  }

  const positions = createRelativePositions(
    schema,
    state,
    documentId,
    options.positionCheckpoint === undefined
      ? undefined
      : parsePositionCheckpoint(options.positionCheckpoint),
  );

  let allocationNodes: readonly N[] | undefined;
  let occupiedIds: ReadonlySet<number> = new Set();
  const listeners = new Set<() => void>();
  const updateListeners = new Set<(update: ExtensionUpdate<N>) => void>();

  function notify(update: ExtensionUpdate<N>) {
    // Snapshot both channels before callbacks. Semantic updates precede view invalidation.
    const updates = [...updateListeners],
      pending = [...listeners];

    publishing = true;

    try {
      for (const listener of updates) notifyListener(() => listener(update));

      for (const listener of pending) notifyListener(listener);
    } finally {
      publishing = false;
    }
  }

  const past: HistoryEntry<N>[] = [],
    future: HistoryEntry<N>[] = [],
    journal: RevisionMap[] = [];

  function restore(redo: boolean) {
    assertWritable();

    const source = redo ? future : past,
      target = redo ? past : future,
      entry = source.at(-1);

    if (!entry) return null;

    const { nodes, changedIds } = restoreChanges(
      state.nodes,
      entry.changes,
      redo ? 'forward' : 'backward',
    );

    validateTree(schema, nodes);

    const context = selectionContext(schema, nodes),
      nextSelection = (redo ? entry.after : entry.before).resolve(context);

    selections.validate(context, nextSelection);

    const next = {
        nodes,
        selection: nextSelection,
        revision: state.revision + 1,
        storedMarks: redo ? entry.afterMarks : entry.beforeMarks,
      },
      maps = redo ? entry.maps : [...entry.maps].toReversed().map(invertAnchorMap);

    if (options.permissions) {
      // Undoing a split joins content again; current source access still applies.
      const tree = indexTree(schema, state.nodes);

      for (const map of maps)
        if (map.kind === 'join') {
          const left = tree.byKey.get(map.key)?.node,
            right = tree.byKey.get(map.rightKey)?.node;

          if (left && right)
            assertContentEditAllowed(
              schema,
              state.nodes,
              { kind: 'join', left: left.id, right: right.id },
              options.permissions,
            );
        }

      assertEditAllowed(schema, state.nodes, next.nodes, options.permissions);
    }

    const positionMapping = {
      before: state,
      after: next,
      maps: redo ? entry.positionMaps : [...entry.positionMaps].toReversed().map(invertPositionMap),
    };

    const update: ExtensionUpdate<N> = {
      kind: redo ? 'redo' : 'undo',
      before: state,
      after: next,
      mapping: positionMapping,
    };

    prepareFields(update);
    positions.advance(next, maps, { operations: entry.operations, redo });
    source.pop();
    target.push(entry);
    boundary = true;
    journal.push({ from: state.revision, to: state.revision + 1, maps });

    state = next;
    notify(update);

    return { state, changedIds, positionMapping };
  }

  const editor = {
    get state() {
      return state;
    },
    /** Runs after atomic publication and before view subscriptions. Dispatch from
     * a subscriber is rejected; schedule a subsequent edit after publication. */
    onUpdate(listener: (update: ExtensionUpdate<N>) => void) {
      updateListeners.add(listener);

      return () => {
        updateListeners.delete(listener);
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    chain() {
      return createCommandChain(commandHost());
    },
    can() {
      return createCommandChain(commandHost(), true);
    },
    commandState<Args extends unknown[]>(
      command: CommandDefinition<N, Args>,
      ...args: Args
    ): CommandState {
      return {
        available: editor
          .can()
          .command(command.execute, ...args)
          .run(),
        activity: command.activity?.({ state, schema }, ...args) ?? 'inactive',
      };
    },
    documentId,
    positions: positions.api,
    find: createFind(schema, () => state.nodes),
    get journal(): readonly RevisionMap[] {
      return journal;
    },
    /** Discards the legacy journal, not the retained metadata used by relative positions. */
    compactJournal(through = state.revision) {
      assertWritable();

      if (!Number.isSafeInteger(through) || through < 0 || through > state.revision)
        throw new Error('Invalid compaction revision');
      let count = 0;

      while (count < journal.length && journal[count].to <= through) count++;
      journal.splice(0, count);
    },
    get history() {
      return { undo: past.length, redo: future.length };
    },
    allocateBlockId() {
      assertWritable();

      // A paste allocates thousands of identities before publishing any nodes.
      // Scan once per immutable document, including externally inserted IDs.
      if (allocationNodes !== state.nodes) {
        occupiedIds = new Set(indexTree(schema, state.nodes).byId.keys());
        allocationNodes = state.nodes;
      }

      while (occupiedIds.has(nextId)) nextId--;

      return nextId--;
    },
    breakHistory(this: void) {
      assertWritable();
      boundary = true;
    },
    selectionJSON() {
      return state.selection.encode(selectionContext(schema, state.nodes));
    },
    readSelection(value: JsonValue) {
      return selections.read(selectionContext(schema, state.nodes), value);
    },
    selectionEdit(text: string) {
      return state.selection.replace(selectionContext(schema, state.nodes), text);
    },
    select(this: void, next: Selection) {
      assertWritable();
      selections.validate(selectionContext(schema, state.nodes), next);

      const after = {
        ...state,
        selection: next,
        storedMarks: state.selection.eq(next) ? state.storedMarks : null,
      };

      const update: ExtensionUpdate<N> = { kind: 'selection', before: state, after };
      prepareFields(update);

      if (!state.selection.eq(next)) boundary = true;
      state = after;
      notify(update);

      return state;
    },
    setStoredMarks(marks: readonly Mark[] | null) {
      assertWritable();
      const selectionValue = state.selection;

      if (
        !(selectionValue instanceof TextSelection) ||
        selectionValue.anchor.id !== selectionValue.head.id ||
        selectionValue.anchor.offset !== selectionValue.head.offset
      )
        throw new Error('Stored marks require a caret');
      const node = indexTree(schema, state.nodes).byId.get(selectionValue.head.id)?.node;

      if (!node || !schema.editing(node).marks) throw new Error('Text does not support marks');
      const adapter = schema.editing(node).marks;

      if (options.permissions)
        assertContentEditAllowed(
          schema,
          state.nodes,
          {
            kind: 'replaceText',
            id: node.id,
            from: selectionValue.head.offset,
            to: selectionValue.head.offset,
            text: '',
          },
          options.permissions,
        );
      const checked = marks === null ? null : (adapter?.validate?.(marks) ?? marks);

      if (checked && new Set(checked.map((mark) => mark.type)).size !== checked.length)
        throw new Error('Duplicate stored mark type');
      const after = { ...state, storedMarks: checked === null ? null : structuredClone(checked) };
      const update: ExtensionUpdate<N> = { kind: 'storedMarks', before: state, after };
      prepareFields(update);
      state = after;
      boundary = true;
      notify(update);

      return state;
    },
    dispatch(tx: Transaction<N>) {
      assertWritable();
      const result = applyTransaction(schema, state, tx, selections, options.permissions);

      const update: ExtensionUpdate<N> = {
        kind: 'transaction',
        before: state,
        after: result.state,
        transaction: tx,
        mapping: result.positionMapping,
      };

      prepareFields(update);
      const operations = positions.advance(result.state, result.anchorMaps);

      if (tx.origin === 'local' && result.changes.length) {
        const group = tx.history === 'separate' ? null : tx.history.group,
          last = past.at(-1);

        if (
          !boundary &&
          group !== null &&
          last?.group === group &&
          tx.time >= last.time &&
          (group.startsWith('composition:') || tx.time - last.time < 750) &&
          last.afterSelection.eq(state.selection)
        ) {
          last.changes.push(...result.changes);
          last.maps.push(...result.anchorMaps);
          last.positionMaps.push(...result.maps);
          last.operations.push(...operations);
          last.after = result.state.selection.getBookmark();
          last.afterSelection = result.state.selection;
          last.afterMarks = result.state.storedMarks ?? null;
          last.time = tx.time;
        } else {
          past.push({
            changes: [...result.changes],
            maps: [...result.anchorMaps],
            positionMaps: [...result.maps],
            operations: [...operations],
            before: state.selection.getBookmark(),
            after: result.state.selection.getBookmark(),
            afterSelection: result.state.selection,
            beforeMarks: state.storedMarks ?? null,
            afterMarks: result.state.storedMarks ?? null,
            group,
            time: tx.time,
          });

          if (past.length > 256) past.shift();
        }

        future.length = 0;
        boundary = group === null;
      }

      journal.push({ from: state.revision, to: result.state.revision, maps: result.anchorMaps });
      state = result.state;
      notify(update);

      return result;
    },
    undo: () => restore(false),
    redo: () => restore(true),
  };

  function commandHost() {
    const base = state;

    const drafts = new WeakMap<
      EditorState<N>,
      {
        steps: readonly Step<N>[];
        maps: readonly PositionMap[];
        marks: readonly Mark[] | null | undefined;
      }
    >();

    return {
      schema,
      nodeIds: (draft: EditorState<N>) => indexTree(schema, draft.nodes).byId.keys(),
      get state() {
        return state;
      },
      preview(draft: EditorState<N>, tx: Transaction<N>) {
        const result = applyTransaction(schema, draft, tx, selections, options.permissions);
        const prefix = drafts.get(draft);
        const steps = [...(prefix?.steps ?? []), ...tx.steps];
        const maps = [...(prefix?.maps ?? []), ...result.maps];

        const marks =
          tx.storedMarks !== undefined
            ? tx.storedMarks
            : draft.selection.eq(result.state.selection)
              ? prefix?.marks
              : undefined;

        const marksOnly =
          !steps.length && base.selection.eq(result.state.selection) && marks !== undefined;

        // Apply only the new steps, but project fields from the chain's original
        // snapshot. Intermediate commands belong to one transaction and revision.
        result.state.revision = base.revision + (marksOnly ? 0 : 1);

        const transaction = {
          ...tx,
          baseRevision: base.revision,
          steps,
          selection: result.state.selection,
          storedMarks: marks,
        };

        prepareFields(
          marksOnly
            ? {
                kind: 'storedMarks',
                before: base,
                after: result.state,
              }
            : {
                kind: 'transaction',
                before: base,
                after: result.state,
                transaction,
                mapping: { before: base, after: result.state, maps },
              },
        );
        drafts.set(result.state, { steps, maps, marks });

        return result.state;
      },
      dispatch(tx: Transaction<N>) {
        if (
          !tx.steps.length &&
          (!tx.selection || state.selection.eq(tx.selection)) &&
          tx.storedMarks !== undefined
        )
          return editor.setStoredMarks(tx.storedMarks);

        return editor.dispatch(tx);
      },
    };
  }

  return editor;
}
