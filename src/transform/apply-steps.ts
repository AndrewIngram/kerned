import {
  type Mark,
  type NodeIdentity,
  type Schema,
  validateTextRange,
  indexTree,
  validateTree,
  childrenAt,
  spliceChildren,
  type TreeIndex,
} from '../model';
import type { AnchorMap } from './anchor-maps';
import { removalBoundaries } from './boundary-maps';
import { markInsertedText } from './inserted-marks';
import type { PositionMap } from './positions';
import { replaceRanges } from './replace-ranges';
import type { Step } from './steps';

export type DocumentChange<N extends NodeIdentity> = { index: number; before: N[]; after: N[] };

export type TransformResult<N extends NodeIdentity> = {
  nodes: N[];
  changes: DocumentChange<N>[];
  maps: PositionMap[];
  anchorMaps: AnchorMap[];
  changedIds: number[];
  tree: TreeIndex<N>;
};

export type TransformOptions<N extends NodeIdentity> = {
  insertedMarks?: readonly Mark[];
  /** Called before each step; throwing rejects the transform without publishing a document. */
  beforeStep?: (nodes: N[], step: Step<N>) => void;
};

/** Apply document operations without a session, selection, revision or history policy. */
export function applySteps<N extends NodeIdentity>(
  schema: Schema<N>,
  initial: N[],
  steps: readonly Step<N>[],
  options: TransformOptions<N> = {},
): TransformResult<N> {
  let nodes = initial;
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

  const changes: DocumentChange<N>[] = [],
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

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
    const step = steps[stepIndex];

    if (step.kind !== 'updateBlock') options.beforeStep?.(nodes, step);

    if (step.kind === 'updateBlock') {
      const batchStart = stepIndex;

      // Property edits leave paths and identities intact. Validate consecutive
      // updates in order, then copy the affected branches and publish once.
      // An observer must see the document produced by every preceding step,
      // so observed updates publish individually instead of sharing this batch.
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

      for (; stepIndex < steps.length; stepIndex++) {
        const update = steps[stepIndex];

        if (update.kind !== 'updateBlock' || (options.beforeStep && stepIndex > batchStart)) break;

        options.beforeStep?.(nodes, update);
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
      const next = nodes.concat(step.nodes);
      treeFor(next);
      maps.push({
        kind: 'children',
        parent: null,
        index: nodes.length,
        removed: 0,
        inserted: step.nodes.length,
      });
      changes.push({ index: nodes.length, before: [], after: step.nodes });
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
          options.insertedMarks,
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

        if (options.insertedMarks)
          next = markInsertedText(schema, next, step.from, step.text.length, options.insertedMarks);

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

  return { nodes, changes, maps, anchorMaps, changedIds: [...changedIds], tree };
}

/** Restore identity-checked change slices; rejects stale history instead of overwriting edits. */
export function restoreChanges<N extends NodeIdentity>(
  initial: N[],
  changes: readonly DocumentChange<N>[],
  direction: 'forward' | 'backward',
) {
  let nodes = initial;
  const changedIds = new Set<number>();

  for (const change of direction === 'forward' ? changes : [...changes].toReversed()) {
    const expected = direction === 'forward' ? change.before : change.after,
      replacement = direction === 'forward' ? change.after : change.before;

    const index = expected.length ? nodes.findIndex((n) => n.id === expected[0].id) : change.index;

    if (index < 0 || index > nodes.length || expected.some((n, i) => nodes[index + i] !== n))
      throw new Error('History needs rebasing before this action can be undone');
    nodes = [...nodes.slice(0, index), ...replacement, ...nodes.slice(index + expected.length)];

    for (const n of [...expected, ...replacement]) changedIds.add(n.id);
  }

  return { nodes, changedIds: [...changedIds] };
}
