import { rangeSelection, NodeSelection, TextSelection, type Selection } from './selection';
import type { NavigationKey } from './keyboard-navigation';

/** Rendered document order, including atomic views of structured nodes. */
export type NavigationNode = { id: number; text: string | null; selectable: boolean };

/** A node is a navigation stop between text blocks. Modified text movement stays
 * with the text navigator; custom selections retain their extension's policy. */
export function moveNodeSelection(
  selection: Selection,
  event: NavigationKey,
  nodes: readonly NavigationNode[],
  textMove: TextSelection | null,
): Selection | null {
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    !/^Arrow(Left|Right|Up|Down)$/.test(event.key)
  )
    return null;
  const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
  const direction = back ? -1 : 1;

  const id =
    selection instanceof NodeSelection
      ? selection.id
      : selection instanceof TextSelection
        ? selection.head.id
        : null;

  const index = nodes.findIndex((node) => node.id === id);

  if (index < 0) return null;

  function adjacent(step: number, textOnly = false) {
    for (let at = index + step; at >= 0 && at < nodes.length; at += step) {
      const node = nodes[at];

      if (node.text !== null || (!textOnly && node.selectable)) return node;
    }

    return null;
  }

  const next = adjacent(direction);

  if (selection instanceof NodeSelection) {
    if (!next) return selection;

    if (event.shiftKey) {
      return rangeSelection(
        { kind: 'node', id: selection.id, side: back ? 'after' : 'before' },
        next.text === null
          ? { kind: 'node', id: next.id, side: back ? 'before' : 'after' }
          : { kind: 'text', id: next.id, offset: back ? next.text.length : 0 },
      );
    }

    return next.text === null
      ? new NodeSelection(next.id)
      : new TextSelection({ id: next.id, offset: back ? next.text.length : 0 });
  }

  if (
    !(selection instanceof TextSelection) ||
    (!event.shiftKey &&
      (selection.anchor.id !== selection.head.id ||
        selection.anchor.offset !== selection.head.offset)) ||
    !next ||
    next.text !== null
  )
    return null;
  const current = nodes[index];
  const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
  const atEdge = selection.head.offset === (back ? 0 : current.text?.length);
  const crossesBlock = textMove !== null && textMove.head.id !== selection.head.id;

  if (crossesBlock || (atEdge && (horizontal || textMove?.eq(selection))))
    return event.shiftKey
      ? rangeSelection(
          { kind: 'text', ...selection.anchor },
          { kind: 'node', id: next.id, side: back ? 'before' : 'after' },
        )
      : new NodeSelection(next.id);

  return null;
}

/** Seed layout-based word, line and page movement at a selected node's edge. */
export function textBoundaryNearNode(
  selection: NodeSelection,
  nodes: readonly NavigationNode[],
  back: boolean,
  extend: boolean,
): TextSelection | null {
  const index = nodes.findIndex((node) => node.id === selection.id);

  if (index < 0) return null;

  function boundary(step: number) {
    for (let at = index + step; at >= 0 && at < nodes.length; at += step) {
      const node = nodes[at];

      if (node.text !== null) return { id: node.id, offset: step < 0 ? node.text.length : 0 };
    }

    return null;
  }

  const head = boundary(back ? -1 : 1),
    opposite = boundary(back ? 1 : -1);

  if (extend) return head && opposite ? new TextSelection(opposite, head) : null;

  return head ? new TextSelection(head) : opposite ? new TextSelection(opposite) : null;
}
