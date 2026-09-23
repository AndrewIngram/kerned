import type { NodeIdentity, SelectionRange, TreeIndex } from '@kerned/model';

import { RangeSelection, type RangeEndpoint } from './range-selection.js';
import type { Selection } from './selection-base.js';
import { TextSelection, type SelectionContext } from './selection.js';

/** Selection inside a node's subtree. Offsets are snapshot-local UTF-16 positions.
 * A node selected through an ancestor is also `node`. A structural caret belongs
 * to the endpoint's parent, not the node it sits beside. Empty selected text
 * ranges remain ranges; they are not necessarily insertion carets.
 */
export type ScopedSelection =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'node' }>
  | Readonly<{ kind: 'caret'; point: Readonly<RangeEndpoint>; upstream: boolean }>
  | Readonly<{ kind: 'range'; ranges: readonly Readonly<SelectionRange>[] }>;

const none: ScopedSelection = Object.freeze({ kind: 'none' });

const whole: ScopedSelection = Object.freeze({ kind: 'node' });

/** Compare scoped content, independently of the global selection's direction/type. */
export function equalScopedSelection(a: ScopedSelection, b: ScopedSelection): boolean {
  if (a === b) return true;

  if (a.kind !== b.kind) return false;

  if (a.kind === 'caret' && b.kind === 'caret') {
    const left = a.point,
      right = b.point;

    return (
      a.upstream === b.upstream &&
      left.id === right.id &&
      (left.kind === 'text'
        ? right.kind === 'text' && left.offset === right.offset
        : right.kind === 'node' && left.side === right.side)
    );
  }

  if (a.kind === 'range' && b.kind === 'range')
    return (
      a.ranges.length === b.ranges.length &&
      a.ranges.every((left, index) => {
        const right = b.ranges[index];

        return (
          left.id === right.id &&
          (left.kind === 'node'
            ? right.kind === 'node'
            : right.kind === 'text' && left.from === right.from && left.to === right.to)
        );
      })
    );

  return true;
}

/** Clip a text node's scoped selection to a mark/inline interval. At a shared boundary, caret affinity chooses
 * the preceding interval when upstream, otherwise the following interval.
 * Whole-node selection is preserved, so renderers can distinguish it from text.
 */
export function selectionInText(
  selection: ScopedSelection,
  id: number,
  from: number,
  to: number,
): ScopedSelection {
  if (selection.kind === 'caret') {
    const { point, upstream } = selection;

    return point.kind === 'text' &&
      point.id === id &&
      (point.offset > from || (point.offset === from && !upstream)) &&
      (point.offset < to || (point.offset === to && upstream))
      ? selection
      : none;
  }

  if (selection.kind !== 'range') return selection;

  const ranges = selection.ranges.flatMap((range): Readonly<SelectionRange>[] => {
    if (range.id !== id || range.kind !== 'text') return [];

    const start = Math.max(from, range.from),
      end = Math.min(to, range.to);

    return start < end || (range.from === range.to && from <= range.from && range.from < to)
      ? [{ ...range, from: start, to: end }]
      : [];
  });

  return ranges.length ? { kind: 'range', ranges } : none;
}

/** One index per session selection/tree, never one document traversal per renderer. */
export function indexSelection<N extends NodeIdentity>(
  selection: Selection,
  context: SelectionContext,
  tree: TreeIndex<N>,
) {
  const scoped = new Map<number, ScopedSelection>();
  const ranges = selection.ranges(context);
  let caret: Extract<ScopedSelection, { kind: 'caret' }> | undefined;

  if (selection.isEmpty(context)) {
    if (selection instanceof TextSelection)
      caret = {
        kind: 'caret',
        point: { kind: 'text', ...selection.head },
        upstream: selection.upstream,
      };
    else if (selection instanceof RangeSelection)
      caret = { kind: 'caret', point: { ...selection.head }, upstream: selection.upstream };
    else if (ranges.length === 1 && ranges[0].kind === 'text')
      caret = {
        kind: 'caret',
        point: { kind: 'text', id: ranges[0].id, offset: ranges[0].from },
        upstream: false,
      };
  }

  function ancestors(id: number, visit: (id: number) => void) {
    let entry = tree.byId.get(id);

    while (entry) {
      visit(entry.node.id);
      entry = entry.parent === null ? undefined : tree.byId.get(entry.parent);
    }
  }

  if (caret) {
    const value = caret;
    const id = value.point.kind === 'text' ? value.point.id : tree.byId.get(value.point.id)?.parent;

    if (id !== null && id !== undefined) ancestors(id, (ancestor) => scoped.set(ancestor, value));
  } else {
    const within = new Map<number, Readonly<SelectionRange>[]>();

    for (const range of ranges) {
      const copy = { ...range };
      ancestors(range.id, (id) => {
        const current = within.get(id);

        if (current) current.push(copy);
        else within.set(id, [copy]);
      });

      if (range.kind === 'node') scoped.set(range.id, whole);
    }

    for (const [id, contents] of within)
      if (!scoped.has(id)) scoped.set(id, { kind: 'range', ranges: contents });
  }

  return (id: number): ScopedSelection | undefined => {
    let entry = tree.byId.get(id);

    if (!entry) return undefined;
    const local = scoped.get(id) ?? none;

    while (entry) {
      if (scoped.get(entry.node.id)?.kind === 'node') return whole;
      entry = entry.parent === null ? undefined : tree.byId.get(entry.parent);
    }

    return local;
  };
}
