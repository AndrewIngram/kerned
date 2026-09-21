import {
  type Mark,
  type NodeIdentity,
  type Schema,
  type SelectionRange,
  validateTextRange,
  type TreeIndex,
} from '../model';
import type { AnchorMap } from './anchor-maps';
import { markInsertedText } from './inserted-marks';
import type { PositionMap } from './positions';

/** Replace ordered, non-overlapping fragments and join their text into the first
 * fragment. The command owns which empty containers may be removed. */
export function replaceRanges<N extends NodeIdentity>(
  schema: Schema<N>,
  nodes: readonly N[],
  tree: TreeIndex<N>,
  ranges: readonly SelectionRange[],
  text: string,
  pruneEmpty: readonly number[],
  marks?: readonly Mark[],
) {
  const first = ranges[0];

  if (first?.kind !== 'text') throw new Error('Range replacement requires a text start');

  const selected = new Set<number>(),
    prunable = new Set(pruneEmpty);

  const maps: PositionMap[] = [],
    anchorMaps: AnchorMap[] = [],
    joinedKeys = new Set<string>();

  let replacement: N | undefined;

  for (const range of ranges) {
    if (selected.has(range.id)) throw new Error('Duplicate replacement range');
    selected.add(range.id);
    const node = tree.byId.get(range.id)?.node;

    if (!node) throw new Error('Missing selected block');

    if (range.kind === 'node') continue;

    const editing = schema.editing(node),
      original = editing.text(node),
      inserted = range === first ? text : '';

    // Both ends of a complete string are grapheme boundaries. Interior cuts
    // still need validation, but deleting a book need not segment every word.
    if (range.from !== 0 || range.to !== original.length)
      validateTextRange(original, range.from, range.to);
    let next = editing.replace(node, range.from, range.to, inserted);

    if (marks && range === first)
      next = markInsertedText(schema, next, range.from, inserted.length, marks);

    if (
      next.id !== node.id ||
      next.key !== node.key ||
      schema.text(next) !== original.slice(0, range.from) + inserted + original.slice(range.to)
    )
      throw new Error('Text extension violated replacement contract');

    if (next !== node) {
      maps.push({
        kind: 'replace',
        id: node.id,
        from: range.from,
        to: range.to,
        inserted: inserted.length,
      });
      anchorMaps.push({
        kind: 'replace',
        key: node.key,
        from: range.from,
        to: range.to,
        inserted: inserted.length,
      });
    }

    if (!replacement) {
      replacement = next;
      continue;
    }

    const left = replacement,
      at = schema.editing(left).text(left).length;

    replacement = schema.editing(left).join(left, next);

    if (
      replacement.id !== left.id ||
      replacement.key !== left.key ||
      schema.text(replacement) !== schema.editing(left).text(left) + schema.editing(next).text(next)
    )
      throw new Error('Text extension violated join contract');
    const joinedText = schema.editing(replacement).text(replacement);

    if (at !== 0 && at !== joinedText.length) validateTextRange(joinedText, at, at);
    maps.push({ kind: 'join', left: left.id, right: node.id, at });
    anchorMaps.push({ kind: 'join', key: left.key, rightKey: node.key, at });
    joinedKeys.add(node.key);
  }

  if (!replacement) throw new Error('Missing replacement text');
  const joined = replacement;

  for (const id of prunable) {
    const node = tree.byId.get(id)?.node;

    if (!node || schema.resolve(node).kind !== 'container')
      throw new Error('Only containers can be pruned');
  }

  let visited = 0;

  function rewrite(children: readonly N[]): N[] {
    const result: N[] = [];

    for (const node of children) {
      if (selected.has(node.id)) {
        if (ranges[visited++]?.id !== node.id)
          throw new Error('Replacement ranges must follow document order without overlap');

        if (node.id === first.id) result.push(joined);
        continue;
      }

      const before = schema.children(node);

      if (!before.length) {
        result.push(node);
        continue;
      }

      const after = rewrite(before);

      if (after.length === before.length && after.every((child, i) => child === before[i]))
        result.push(node);
      else if (after.length || !prunable.has(node.id))
        result.push(schema.withChildren(node, after));
    }

    return result;
  }

  const next = rewrite(nodes);

  if (visited !== ranges.length) throw new Error('Replacement ranges overlap');

  return { nodes: next, maps, anchorMaps, joinedKeys };
}
