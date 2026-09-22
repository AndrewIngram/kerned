import {
  type Mark,
  type NodeIdentity,
  type Schema,
  type JsonValue,
  type TreeIndex,
  indexTree,
  validateTree,
} from '../model';
import {
  type AnchorMap,
  type RevisionMap,
  type SnapshotTransition,
  type PositionMap,
  applySteps,
  type DocumentChange,
  type Step,
} from '../transform';
import {
  createCommandChain,
  type CommandDefinition,
  type CommandState,
  type CommandOptions,
} from './commands';
import { createEditorEvents, type EditorEvents } from './events';
import type { StateFieldRegistration, ExtensionUpdate } from './extension-state';
import { createFindSession } from './find';
import { createLocalHistory, type HistoryOptions } from './local-history';
import {
  assertEditAllowed,
  assertContentEditAllowed,
  nodeAccess,
  type AccessPolicy,
} from './permissions';
import { createRelativePositions, parsePositionCheckpoint } from './relative-positions';
import { indexSelection } from './scoped-selection';
import {
  TextSelection,
  selectionContext,
  selectionMapping,
  createSelectionRegistry,
  type SelectionExtension,
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
  readonly nodes: readonly N[];
  readonly selection: Selection;
  readonly revision: number;
  readonly storedMarks?: readonly Mark[] | null;
};

type Applied<N extends NodeIdentity> = {
  state: EditorState<N>;
  tree: TreeIndex<N>;
  changes: DocumentChange<N>[];
  maps: PositionMap[];
  anchorMaps: AnchorMap[];
  changedIds: number[];
  positionMapping: SnapshotTransition<N>;
};

export type EditorOptions<N extends NodeIdentity = NodeIdentity> = {
  documentId?: string;
  revision?: number;
  positionCheckpoint?: unknown;
  permissions?: AccessPolicy<N>;
  fields?: readonly StateFieldRegistration<N>[];
  /** Null disables history. The imperative session defaults to local history. */
  history?: HistoryOptions | null;
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

    if (!node || (!adapter && tx.storedMarks?.length))
      throw new Error('Text does not support marks');

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
      tx.storedMarks === null || !adapter
        ? null
        : (adapter.validate?.(tx.storedMarks) ?? tx.storedMarks);

    if (checked && new Set(checked.map((mark) => mark.type)).size !== checked.length)
      throw new Error('Duplicate stored mark type');
    storedMarks = checked === null ? null : structuredClone(checked);
  }

  const next = { nodes, selection, revision: state.revision + 1, storedMarks };

  return {
    state: next,
    tree,
    changes,
    maps,
    anchorMaps,
    changedIds,
    positionMapping: { before: state, after: next, maps },
  };
}

/** Local history only. A collaboration adapter must rebase operations and history;
 * stale transactions are rejected rather than silently replayed over newer state. */
export function createEditor<N extends NodeIdentity>(
  schema: Schema<N>,
  initial: readonly N[],
  selection: Selection,
  extensions: readonly SelectionExtension[] = [],
  options: EditorOptions<N> = {},
) {
  const selections = createSelectionRegistry(extensions);
  let currentTree = validateTree(schema, initial);

  let selectionIndex: ReturnType<typeof indexSelection<N>> | undefined;

  selections.validate(selectionContext(schema, initial), selection);

  const documentId = options.documentId ?? crypto.randomUUID(),
    revision = options.revision ?? 0;

  if (!documentId || !Number.isSafeInteger(revision) || revision < 0)
    throw new Error('Invalid document identity or revision');

  let state: EditorState<N> = { nodes: initial, selection, revision, storedMarks: null },
    nextId = -1;

  const history = options.history === null ? null : createLocalHistory<N>(options.history);
  const fields = [...new Set(options.fields ?? [])];

  for (const field of fields) field.initialize(state);

  let preparing = false,
    publishing = false,
    destroyed = false;

  function assertActive() {
    if (destroyed) throw new Error('Editor is destroyed');
  }

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
    assertActive();

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
  const events = createEditorEvents<N>();
  const find = createFindSession(schema, () => state.nodes);
  events.on('content', find.refresh);
  events.on('destroy', find.destroy);

  function notify(update: ExtensionUpdate<N>) {
    publishing = true;

    try {
      events.publish(update);
    } finally {
      publishing = false;
    }
  }

  const journal: RevisionMap[] = [];

  function prepareRestore(redo: boolean) {
    assertActive();

    const replay = history?.prepare(state.nodes, redo ? 'redo' : 'undo');

    if (!replay) return null;
    const { nodes, changedIds, maps } = replay;

    const tree = validateTree(schema, nodes);

    const context = selectionContext(schema, nodes, tree),
      nextSelection = replay.selection.resolve(context);

    selections.validate(context, nextSelection);

    const next = {
      nodes,
      selection: nextSelection,
      revision: state.revision + 1,
      storedMarks: replay.storedMarks,
    };

    const positionMapping = {
      before: state,
      after: next,
      maps: replay.positionMaps,
    };

    const update: ExtensionUpdate<N> = {
      kind: redo ? 'redo' : 'undo',
      before: state,
      after: next,
      mapping: positionMapping,
    };

    const validate = () => {
      assertActive();

      if (state !== update.before || !replay.isCurrent()) return false;

      if (options.permissions) {
        // Undoing a split joins content again; current source access still applies.
        for (const map of maps)
          if (map.kind === 'join') {
            const left = currentTree.byKey.get(map.key)?.node,
              right = currentTree.byKey.get(map.rightKey)?.node;

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

      prepareFields(update);

      return true;
    };

    validate();

    return {
      state: next,
      validate,
      publish() {
        positions.advance(next, maps, { operations: replay.operations, redo });
        replay.commit();
        journal.push({ from: state.revision, to: next.revision, maps });
        state = next;
        currentTree = tree;
        selectionIndex = undefined;
        notify(update);

        return { state, changedIds, positionMapping };
      },
    };
  }

  function restore(redo: boolean) {
    assertWritable();

    return prepareRestore(redo)?.publish() ?? null;
  }

  const editor = {
    get state() {
      return state;
    },
    get isDestroyed() {
      return destroyed;
    },
    /** Read the canonical node through the session's current tree index. */
    getNode(id: number) {
      assertActive();

      return currentTree.byId.get(id)?.node;
    },
    getSelection(id: number) {
      assertActive();

      selectionIndex ??= indexSelection(
        state.selection,
        selectionContext(schema, state.nodes, currentTree),
        currentTree,
      );

      return selectionIndex(id);
    },
    getAccess(id: number) {
      assertActive();

      return nodeAccess(currentTree, id, options.permissions);
    },
    /** Publish external permission changes without a document edit or history entry. */
    refreshPermissions() {
      assertWritable();
      const after = { ...state };
      const update: ExtensionUpdate<N> = { kind: 'permissions', before: state, after };
      prepareFields(update);
      state = after;
      history?.closeGroup();
      notify(update);
    },
    /** Idempotent. The final snapshot remains readable, but all writes and subscriptions stop. */
    destroy() {
      if (destroyed) return;
      assertWritable();
      destroyed = true;
      selectionIndex = undefined;
      history?.clear();
      journal.length = 0;
      allocationNodes = undefined;
      occupiedIds = new Set();
      events.destroy(state);
    },
    on<Key extends keyof EditorEvents<N>>(
      this: void,
      name: Key,
      listener: (event: EditorEvents<N>[Key]) => void,
    ) {
      assertActive();

      return events.on(name, listener);
    },
    subscribe(listener: () => void) {
      assertActive();

      return events.subscribe(listener);
    },
    chain(commandOptions?: CommandOptions) {
      return createCommandChain(commandHost(), false, commandOptions);
    },
    can(commandOptions?: CommandOptions) {
      return createCommandChain(commandHost(), true, commandOptions);
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
    find: find.api,
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
      return history?.counts ?? { undo: 0, redo: 0 };
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
      history?.closeGroup();
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

      if (!state.selection.eq(next)) history?.closeGroup();
      selectionIndex = undefined;
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

      if (!node || (!schema.editing(node).marks && marks?.length))
        throw new Error('Text does not support marks');
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
      const checked = marks === null || !adapter ? null : (adapter.validate?.(marks) ?? marks);

      if (checked && new Set(checked.map((mark) => mark.type)).size !== checked.length)
        throw new Error('Duplicate stored mark type');
      const after = { ...state, storedMarks: checked === null ? null : structuredClone(checked) };
      const update: ExtensionUpdate<N> = { kind: 'storedMarks', before: state, after };
      prepareFields(update);
      state = after;
      history?.closeGroup();
      notify(update);

      return state;
    },
    dispatch(tx: Transaction<N>) {
      assertWritable();

      const { tree, ...result } = applyTransaction(
        schema,
        state,
        tx,
        selections,
        options.permissions,
      );

      const update: ExtensionUpdate<N> = {
        kind: 'transaction',
        before: state,
        after: result.state,
        transaction: tx,
        mapping: result.positionMapping,
      };

      prepareFields(update);
      const operations = positions.advance(result.state, result.anchorMaps);

      if (tx.origin === 'local')
        history?.record({
          before: state,
          after: result.state,
          transaction: tx,
          changes: result.changes,
          maps: result.maps,
          anchorMaps: result.anchorMaps,
          operations,
        });

      journal.push({ from: state.revision, to: result.state.revision, maps: result.anchorMaps });
      state = result.state;
      currentTree = tree;
      selectionIndex = undefined;
      notify(update);

      return result;
    },
    undo: () => restore(false),
    redo: () => restore(true),
  };

  function commandHost() {
    assertActive();
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
      assertActive,
      prepareHistory(direction: 'undo' | 'redo') {
        const redo = direction === 'redo';
        const prepared = prepareRestore(redo);

        if (!prepared) return null;

        return {
          state: prepared.state,
          run(dryRun: boolean) {
            if (!dryRun) assertWritable();

            if (!prepared.validate()) return false;

            if (!dryRun) prepared.publish();

            return true;
          },
        };
      },
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
        const next = { ...result.state, revision: base.revision + (marksOnly ? 0 : 1) };

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
                after: next,
              }
            : {
                kind: 'transaction',
                before: base,
                after: next,
                transaction,
                mapping: { before: base, after: next, maps },
              },
        );
        drafts.set(next, { steps, maps, marks });

        return next;
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
