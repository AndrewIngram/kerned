import { test, expect } from 'vitest';

test('selection projection preserves node, container, cell and empty selections', async () => {
  const result = await (async () => {
    const { fixture, schema } = await import('../../../tests/fixtures/editor-foundation.js');

    const { selectionView, selectionContext, NodeSelection, AllSelection } =
      await import('../index.ts');

    const editor = fixture(),
      context = selectionContext(schema, editor.state.nodes);

    const nodes = context.order().filter((n) => schema.children(n).length === 0);
    const indexes = new Map(nodes.map((n, i) => [n.id, i]));

    const node = new NodeSelection(17),
      view = selectionView(schema, node, context, indexes);

    const container = selectionView(schema, new NodeSelection(1), context, indexes);
    const all = selectionView(schema, new AllSelection(), context, indexes);

    const empty = selectionView(
      schema,
      new AllSelection(),
      selectionContext(schema, []),
      new Map(),
    );

    return {
      identity: view.selection === node,
      text: view.textSelection,
      focus: view.focusId,
      first: view.selectedRange(nodes[0]),
      atom: view.selectedRange(nodes.at(-1)),
      container: nodes.filter((n) => container.selectedRange(n)).map((n) => n.id),
      all: nodes.filter((n) => all.selectedRange(n)).map((n) => n.id),
      empty: {
        focus: empty.focusId,
        text: empty.textSelection,
        start: empty.start,
        ranges: empty.ranges,
      },
    };
  })();

  expect(result.identity).toBe(true);
  expect(result.text).toBeNull();
  expect(result.focus).toBe(17);
  expect(result.first).toBeNull();
  expect(result.atom).toEqual({ from: 0, to: 1 });
  expect(result.container).toEqual([3, 4]);
  expect(result.all).toEqual([3, 4, 8, 10, 13, 15, 16, 17]);
  expect(result.empty).toEqual({ focus: null, text: null, start: null, ranges: [] });
});

test('atomic navigation respects document order and preserves shift ranges', async () => {
  const result = await (async () => {
    const { moveNodeSelection, NodeSelection, RangeSelection, TextSelection, textSelection } =
      await import('../index.ts');

    const nodes = [
      { id: 1, text: 'Before', selectable: true },
      { id: 2, text: null, selectable: true },
      { id: 3, text: null, selectable: false },
      { id: 4, text: null, selectable: true },
      { id: 5, text: 'After', selectable: true },
    ];

    const key = (keyValue, shiftKey = false) => ({
      key: keyValue,
      shiftKey,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    });

    const describe = (s) =>
      s instanceof TextSelection || s instanceof RangeSelection
        ? { type: s.type, anchor: s.anchor, head: s.head }
        : s
          ? { type: s.type, id: s.id }
          : null;

    const move = (selection, event, textMove = null) =>
      describe(moveNodeSelection(selection, event, nodes, textMove));

    return {
      enter: move(textSelection(1, 6), key('ArrowRight'), textSelection(5, 0)),
      adjacent: move(new NodeSelection(2), key('ArrowRight')),
      back: move(new NodeSelection(2), key('ArrowLeft')),
      forward: move(new NodeSelection(4), key('ArrowDown')),
      shift: move(new NodeSelection(2), key('ArrowRight', true)),
      middle: move(textSelection(1, 3), key('ArrowRight'), textSelection(1, 4)),
      modified: move(new NodeSelection(2), { ...key('ArrowRight'), altKey: true }),
      edge: describe(moveNodeSelection(new NodeSelection(2), key('ArrowLeft'), [nodes[1]], null)),
    };
  })();

  expect(result.enter).toEqual({ type: 'node', id: 2 });
  expect(result.adjacent).toEqual({ type: 'node', id: 4 });
  expect(result.back.head).toEqual({ id: 1, offset: 6 });
  expect(result.forward.head).toEqual({ id: 5, offset: 0 });
  expect(result.shift).toEqual({
    type: 'range',
    anchor: { kind: 'node', id: 2, side: 'before' },
    head: { kind: 'node', id: 4, side: 'after' },
  });
  expect(result.middle).toBeNull();
  expect(result.modified).toBeNull();
  expect(result.edge).toEqual({ type: 'node', id: 2 });
});
