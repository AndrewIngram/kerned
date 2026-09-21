import { invertAnchorMap, type AnchorMap, type RevisionMap } from './anchors';
import { createCommandChain, type CommandDefinition, type CommandState } from './commands';
import type { SnapshotTransition } from './document-positions';
import type { StateFieldRegistration, ExtensionUpdate } from './extension-state';
import { createFind } from './find';
import type { Mark } from './marks';
import { assertEditAllowed, assertContentEditAllowed, type AccessPolicy } from './permissions';
import { invertPositionMap, type PositionMap } from './positions';
import { removalBoundaries } from './relative-boundaries';
import {
  createRelativePositions,
  parsePositionCheckpoint,
  type MappingOperation,
} from './relative-positions';
import { replaceRanges } from './replace-ranges';
import type { NodeIdentity, Schema } from './schema';
import type { JsonValue } from './schema-codec';
import {
  TextSelection,
  Selection,
  selectionContext,
  selectionMapping,
  createSelectionRegistry,
  type SelectionExtension,
  type SelectionBookmark,
  type SelectionRange,
} from './selection';
import { inputMarks, markInsertedText } from './stored-marks';
import { validateTextRange } from './text';
import { indexTree, validateTree, childrenAt, spliceChildren, type TreeIndex } from './tree';

export type Step<N extends NodeIdentity> =
  | { kind: 'replaceText'; id: number; from: number; to: number; text: string }
  | {
      kind: 'replaceRanges';
      ranges: readonly SelectionRange[];
      text: string;
      pruneEmpty: readonly number[];
    }
  | { kind: 'split'; id: number; at: number; rightId: number; rightKey: string }
  | { kind: 'join'; left: number; right: number }
  | { kind: 'updateBlock'; node: N }
  | { kind: 'append'; nodes: N[] }
  | { kind: 'insertChildren'; parent: number | null; index: number; nodes: N[] }
  | { kind: 'replaceChildren'; parent: number | null; index: number; count: number; nodes: N[] }
  | { kind: 'removeChildren'; parent: number | null; index: number; count: number }
  | {
      kind: 'moveChildren';
      parent: number | null;
      index: number;
      count: number;
      toParent: number | null;
      toIndex: number;
    }
  | { kind: 'wrapChildren'; parent: number | null; index: number; count: number; wrapper: N }
  | { kind: 'unwrap'; id: number };

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

type Change<N extends NodeIdentity> = { index: number; before: N[]; after: N[] };

type Applied<N extends NodeIdentity> = {
  state: EditorState<N>;
  changes: Change<N>[];
  maps: PositionMap[];
  anchorMaps: AnchorMap[];
  changedIds: number[];
  positionMapping: SnapshotTransition<N>;
};

type HistoryEntry<N extends NodeIdentity> = {
  changes: Change<N>[];
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
  let nodes = state.nodes;
  const indexes = new WeakMap<readonly N[], TreeIndex<N>>();

  function treeFor(value: readonly N[]) {
    let tree = indexes.get(value);

    if (!tree) {
      tree = indexTree(schema, value);
      indexes.set(value, tree);
    }

    return tree;
  }

  function splice(
    value: N[],
    parent: number | null,
    index: number,
    count: number,
    inserted: readonly N[],
  ) {
    const old = childrenAt(schema, value, parent, treeFor(value)).slice(index, index + count);
    const next = spliceChildren(schema, value, parent, index, count, inserted, treeFor(value));

    let start = 0,
      end = old.length,
      newEnd = inserted.length;

    while (start < end && start < newEnd && old[start].id === inserted[start].id) start++;

    while (end > start && newEnd > start && old[end - 1].id === inserted[newEnd - 1].id) {
      end--;
      newEnd--;
    }

    if (start !== end || start !== newEnd)
      maps.push({
        kind: 'children',
        parent,
        index: index + start,
        removed: end - start,
        inserted: newEnd - start,
      });

    return next;
  }

  const typingMarks =
    tx.origin === 'local' && tx.input ? inputMarks(schema, state, treeFor(state.nodes)) : undefined;

  const changes: Change<N>[] = [],
    maps: PositionMap[] = [],
    anchorMaps: AnchorMap[] = [],
    changedIds = new Set<number>();

  function removalMap(before: TreeIndex<N>, after: TreeIndex<N>, keys: string[]): AnchorMap {
    const fallbacks: {
      key: string;
      before: { key: string; offset: number } | null;
      after: { key: string; offset: number } | null;
    }[] = [];

    let previous: { key: string; offset: number } | null = null;
    const byKey = new Map<string, (typeof fallbacks)[number]>();

    for (const { node } of before.order) {
      const text = schema.text(node);

      if (text === null) continue;

      if (after.byKey.has(node.key)) {
        previous = { key: node.key, offset: text.length };
        continue;
      }

      const entry = { key: node.key, before: previous, after: null };
      fallbacks.push(entry);
      byKey.set(node.key, entry);
    }

    let next: { key: string; offset: number } | null = null;

    for (let i = before.order.length - 1; i >= 0; i--) {
      const node = before.order[i].node;

      if (schema.text(node) === null) continue;

      if (after.byKey.has(node.key)) next = { key: node.key, offset: 0 };
      else {
        const entry = byKey.get(node.key);

        if (entry) entry.after = next;
      }
    }

    return {
      kind: 'remove',
      keys,
      fallbacks,
      boundaries: removalBoundaries(schema, before, after),
    };
  }

  function publish(next: N[], structural: boolean) {
    const oldTree = treeFor(nodes),
      newTree = treeFor(next);

    let start = 0,
      end = nodes.length,
      nextEnd = next.length;

    while (start < end && start < nextEnd && nodes[start] === next[start]) start++;

    while (end > start && nextEnd > start && nodes[end - 1] === next[nextEnd - 1]) {
      end--;
      nextEnd--;
    }

    if (start === end && start === nextEnd) return;
    changes.push({
      index: start,
      before: nodes.slice(start, end),
      after: next.slice(start, nextEnd),
    });

    for (const [id, entry] of oldTree.byId)
      if (newTree.byId.get(id)?.node !== entry.node) changedIds.add(id);

    for (const [id, entry] of newTree.byId)
      if (oldTree.byId.get(id)?.node !== entry.node) changedIds.add(id);

    if (structural) {
      for (const [key, entry] of oldTree.byKey) {
        const nextEntry = newTree.byKey.get(key);

        if (
          nextEntry &&
          (nextEntry.node.id !== entry.node.id ||
            schema.text(nextEntry.node) !== schema.text(entry.node))
        )
          throw new Error('Structural changes must preserve surviving text and identities');
      }

      for (const [id, entry] of oldTree.byId) {
        const nextEntry = newTree.byId.get(id);

        if (nextEntry && nextEntry.node.key !== entry.node.key)
          throw new Error('Structural changes cannot reuse an existing handle for a different key');
      }

      const removed = [...oldTree.byKey.keys()].filter((key) => !newTree.byKey.has(key)),
        inserted = [...newTree.byKey.keys()].filter((key) => !oldTree.byKey.has(key));

      if (removed.length) anchorMaps.push(removalMap(oldTree, newTree, removed));

      if (inserted.length) anchorMaps.push({ kind: 'insert', keys: inserted });
    }

    nodes = next;
  }

  for (let stepIndex = 0; stepIndex < tx.steps.length; stepIndex++) {
    const step = tx.steps[stepIndex];

    if (permissions) assertContentEditAllowed(schema, nodes, step, permissions);

    if (tx.origin === 'stream' && step.kind !== 'append')
      throw new Error('Stream transactions may only append blocks');

    if (step.kind === 'updateBlock') {
      // Property edits leave paths and identities intact. Validate consecutive
      // updates in order, then copy the affected branches and publish once.
      const tree = treeFor(nodes),
        updated = new Map<number, N>(),
        dirtyAncestors = new Set<number>();

      function currentNode(original: N): N {
        let node = updated.get(original.id) ?? original;

        if (dirtyAncestors.delete(node.id)) {
          node = schema.withChildren(node, schema.children(node).map(currentNode));
          updated.set(node.id, node);
        }

        return node;
      }

      for (; stepIndex < tx.steps.length; stepIndex++) {
        const update = tx.steps[stepIndex];

        if (update.kind !== 'updateBlock') break;

        if (permissions) assertContentEditAllowed(schema, nodes, update, permissions);
        const entry = tree.byId.get(update.node.id);

        if (!entry) throw new Error('Missing block');
        const node = currentNode(entry.node);

        if (update.node.key !== node.key)
          throw new Error('Property updates cannot change identity');
        schema.validateUpdate(node, update.node);

        if (schema.text(node) !== schema.text(update.node))
          throw new Error('Property updates cannot change editable text');

        const oldChildren = schema.children(node),
          newChildren = schema.children(update.node);

        if (
          oldChildren.length !== newChildren.length ||
          oldChildren.some((child, i) => child !== newChildren[i])
        )
          throw new Error('Property updates cannot change children');

        if (node === update.node) continue;
        updated.set(node.id, update.node);

        for (let parent = entry.parent; parent !== null;) {
          dirtyAncestors.add(parent);
          const ancestor = tree.byId.get(parent);

          if (!ancestor) throw new Error('Missing ancestor');
          parent = ancestor.parent;
        }
      }

      stepIndex--;

      if (updated.size) publish(nodes.map(currentNode), false);
      continue;
    }

    if (step.kind === 'append') {
      if (tx.origin !== 'stream') throw new Error('Append belongs to the loading stream');
      const next = nodes.concat(step.nodes);
      treeFor(next);
      maps.push({
        kind: 'children',
        parent: null,
        index: nodes.length,
        removed: 0,
        inserted: step.nodes.length,
      });
      nodes = next;

      for (const { node } of treeFor(step.nodes).order) changedIds.add(node.id);
      continue;
    }

    if (step.kind === 'replaceRanges') {
      const before = treeFor(nodes),
        result = replaceRanges(
          schema,
          nodes,
          before,
          step.ranges,
          step.text,
          step.pruneEmpty,
          typingMarks,
        ),
        after = treeFor(result.nodes);

      const removed = [...before.byKey.keys()].filter(
        (key) => !after.byKey.has(key) && !result.joinedKeys.has(key),
      );

      if (removed.length) anchorMaps.push(removalMap(before, after, removed));

      // Bulk range replacement only removes structural occurrences. Descending
      // sibling indexes keep each gap map in its step's coordinate space.
      for (const entry of [...before.order].toReversed())
        if (!after.byId.has(entry.node.id)) {
          maps.push({
            kind: 'children',
            parent: entry.parent,
            index: entry.index,
            removed: 1,
            inserted: 0,
          });
        }

      maps.push(...result.maps);
      anchorMaps.push(...result.anchorMaps);
      publish(result.nodes, false);
      continue;
    }

    if (step.kind === 'insertChildren') {
      publish(splice(nodes, step.parent, step.index, 0, step.nodes), true);
      continue;
    }

    if (step.kind === 'replaceChildren') {
      publish(splice(nodes, step.parent, step.index, step.count, step.nodes), true);
      continue;
    }

    if (step.kind === 'removeChildren') {
      publish(splice(nodes, step.parent, step.index, step.count, []), true);
      continue;
    }

    if (step.kind === 'moveChildren') {
      const children = childrenAt(schema, nodes, step.parent, treeFor(nodes)),
        moving = children.slice(step.index, step.index + step.count);

      if (step.count < 1) throw new Error('Move requires at least one child');

      if (step.toParent !== null && treeFor(moving).byId.has(step.toParent))
        throw new Error('Cannot move a node into its own subtree');
      const removed = splice(nodes, step.parent, step.index, step.count, []);
      publish(splice(removed, step.toParent, step.toIndex, 0, moving), true);
      continue;
    }

    if (step.kind === 'wrapChildren') {
      const children = childrenAt(schema, nodes, step.parent, treeFor(nodes));

      if (
        step.count < 1 ||
        schema.resolve(step.wrapper).kind !== 'container' ||
        schema.children(step.wrapper).length
      )
        throw new Error('Wrap requires an empty container and nonempty child range');

      if (treeFor(nodes).byId.has(step.wrapper.id) || treeFor(nodes).byKey.has(step.wrapper.key))
        throw new Error('Duplicate wrapper identity');

      const wrapper = schema.withChildren(
        step.wrapper,
        children.slice(step.index, step.index + step.count),
      );

      maps.push({
        kind: 'wrap',
        id: wrapper.id,
        parent: step.parent,
        index: step.index,
        count: step.count,
      });
      publish(splice(nodes, step.parent, step.index, step.count, [wrapper]), true);
      continue;
    }

    if (step.kind === 'unwrap') {
      const entry = treeFor(nodes).byId.get(step.id);

      if (!entry || schema.resolve(entry.node).kind !== 'container')
        throw new Error('Unwrap requires a container');
      publish(splice(nodes, entry.parent, entry.index, 1, schema.children(entry.node)), true);
      maps.push({
        kind: 'unwrap',
        id: step.id,
        parent: entry.parent,
        index: entry.index,
        count: schema.children(entry.node).length,
      });
      continue;
    }

    let before: N[] = [],
      after: N[] = [],
      map: PositionMap | undefined,
      anchorMap: AnchorMap | undefined;

    const id = step.kind === 'join' ? step.left : step.id;
    const entry = treeFor(nodes).byId.get(id);

    if (!entry) throw new Error('Missing block');
    const node = entry.node;
    before = [node];

    switch (step.kind) {
      case 'replaceText': {
        const editing = schema.editing(node);
        validateTextRange(editing.text(node), step.from, step.to);
        let next = editing.replace(node, step.from, step.to, step.text);

        if (typingMarks)
          next = markInsertedText(schema, next, step.from, step.text.length, typingMarks);

        if (
          next.id !== node.id ||
          next.key !== node.key ||
          schema.text(next) !==
            editing.text(node).slice(0, step.from) + step.text + editing.text(node).slice(step.to)
        )
          throw new Error('Text extension violated replacement contract');
        after = [next];
        map = { kind: 'replace', id, from: step.from, to: step.to, inserted: step.text.length };
        anchorMap = {
          kind: 'replace',
          key: node.key,
          from: step.from,
          to: step.to,
          inserted: step.text.length,
        };
        break;
      }

      case 'split': {
        const editing = schema.editing(node);
        validateTextRange(editing.text(node), step.at, step.at);

        if (treeFor(nodes).byId.has(step.rightId) || treeFor(nodes).byKey.has(step.rightKey))
          throw new Error('Duplicate block ID');
        after = editing.split(node, step.at, { id: step.rightId, key: step.rightKey });

        if (
          after[0].id !== node.id ||
          after[0].key !== node.key ||
          after[1].id !== step.rightId ||
          after[1].key !== step.rightKey ||
          schema.text(after[0]) !== editing.text(node).slice(0, step.at) ||
          schema.text(after[1]) !== editing.text(node).slice(step.at)
        )
          throw new Error('Text extension violated split contract');
        map = { kind: 'split', id, at: step.at, rightId: step.rightId };
        anchorMap = { kind: 'split', key: node.key, at: step.at, rightKey: step.rightKey };
        break;
      }

      case 'join': {
        const left = node,
          right = childrenAt(schema, nodes, entry.parent, treeFor(nodes))[entry.index + 1];

        if (!right || right.id !== step.right)
          throw new Error('Only adjacent text blocks can join');

        const editing = schema.editing(left),
          at = editing.text(left).length;

        const next = editing.join(left, right);

        if (
          next.id !== left.id ||
          next.key !== left.key ||
          schema.text(next) !== editing.text(left) + schema.editing(right).text(right)
        )
          throw new Error('Text extension violated join contract');
        validateTextRange(schema.editing(next).text(next), at, at);
        after = [next];
        before = [left, right];
        map = { kind: 'join', left: id, right: right.id, at };
        anchorMap = { kind: 'join', key: node.key, rightKey: right.key, at };
        break;
      }
    }

    if (before.length === after.length && before.every((n, i) => n === after[i])) continue;
    after.forEach(schema.resolve);
    publish(splice(nodes, entry.parent, entry.index, before.length, after), false);

    if (map) maps.push(map);

    if (anchorMap) anchorMaps.push(anchorMap);
  }

  const tree = validateTree(schema, nodes, treeFor(nodes));
  const context = selectionContext(schema, nodes, tree);

  const selection =
    tx.selection ??
    state.selection.map(
      context,
      selectionMapping(selectionContext(schema, state.nodes, treeFor(state.nodes)), context, maps),
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
    changedIds: [...changedIds],
    positionMapping: { before: state, after: next, maps },
  };
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
  let preparing = false;

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

  function notify() {
    // Snapshot registration so subscriptions changed by callbacks take effect next time.
    const pending = [...listeners];

    for (const listener of pending) {
      try {
        listener();
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
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
    let nodes = state.nodes;
    const changedIds = new Set<number>();

    for (const change of redo ? entry.changes : [...entry.changes].toReversed()) {
      const expected = redo ? change.before : change.after,
        replacement = redo ? change.after : change.before;

      const index = expected.length
        ? nodes.findIndex((n) => n.id === expected[0].id)
        : change.index;

      if (index < 0 || index > nodes.length || expected.some((n, i) => nodes[index + i] !== n))
        throw new Error('History needs rebasing before this action can be undone');
      nodes = [...nodes.slice(0, index), ...replacement, ...nodes.slice(index + expected.length)];

      for (const n of [...expected, ...replacement]) changedIds.add(n.id);
    }

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

    prepareFields({
      kind: redo ? 'redo' : 'undo',
      before: state,
      after: next,
      mapping: positionMapping,
    });
    positions.advance(next, maps, { operations: entry.operations, redo });
    source.pop();
    target.push(entry);
    boundary = true;
    journal.push({ from: state.revision, to: state.revision + 1, maps });

    state = next;
    notify();

    return { state, changedIds: [...changedIds], positionMapping };
  }

  const editor = {
    get state() {
      return state;
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
        activity: command.activity?.(state, ...args) ?? 'inactive',
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

      prepareFields({ kind: 'selection', before: state, after });

      if (!state.selection.eq(next)) boundary = true;
      state = after;
      notify();

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
      prepareFields({ kind: 'storedMarks', before: state, after });
      state = after;
      boundary = true;
      notify();

      return state;
    },
    dispatch(tx: Transaction<N>) {
      assertWritable();
      const result = applyTransaction(schema, state, tx, selections, options.permissions);
      prepareFields({
        kind: 'transaction',
        before: state,
        after: result.state,
        transaction: tx,
        mapping: result.positionMapping,
      });
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
      notify();

      return result;
    },
    undo: () => restore(false),
    redo: () => restore(true),
  };

  function commandHost() {
    return {
      get state() {
        return state;
      },
      preview(draft: EditorState<N>, tx: Transaction<N>) {
        const result = applyTransaction(schema, draft, tx, selections, options.permissions);
        prepareFields({
          kind: 'transaction',
          before: draft,
          after: result.state,
          transaction: tx,
          mapping: result.positionMapping,
        });

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
