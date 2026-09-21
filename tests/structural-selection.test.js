import { test, expect } from 'vitest';

test('structural ranges preserve direction, hierarchy, codecs and transaction history', async () => {
  const result = await (async () => {
    const { schema } = await import('./fixtures/editor-foundation.js');

    const {
      createEditor,
      RangeSelection,
      selectionContext,
      createSelectionRegistry,
      extendSelection,
    } = await import('../src/state/index.ts');

    const atom = (id) => ({ id, key: `n-${id}`, kind: 'atom' }),
      text = (id, value) => ({ id, key: `n-${id}`, kind: 'text', value });

    const nodes = [
      atom(1),
      text(2, 'Middle'),
      { id: 3, key: 'n-3', kind: 'group', children: [atom(4), text(5, 'Tail')] },
      atom(6),
    ];

    const context = selectionContext(schema, nodes),
      anchor = { kind: 'node', id: 1, side: 'before' },
      head = { kind: 'text', id: 5, offset: 2 };

    const selection = new RangeSelection(anchor, head),
      backward = new RangeSelection(head, anchor);

    const ranges = selection.ranges(context),
      reverse = backward.ranges(context);

    const remap = (node) => {
      const resultValue = { ...node, id: node.id + 100 };

      if (node.children) resultValue.children = node.children.map(remap);

      return resultValue;
    };

    const restored = createSelectionRegistry().read(
      selectionContext(schema, nodes.map(remap)),
      selection.encode(context),
    );

    const editor = createEditor(schema, nodes, selection);
    const edit = editor.selectionEdit('X');
    editor.dispatch({ baseRevision: 0, origin: 'local', history: 'separate', time: 0, ...edit });
    const after = editor.state.nodes;
    editor.undo();

    const undo =
      editor.state.selection.eq(selection) &&
      JSON.stringify(editor.state.nodes) === JSON.stringify(nodes);

    editor.redo();
    const redo = JSON.stringify(editor.state.nodes) === JSON.stringify(after);

    const whole = new RangeSelection(
      { kind: 'node', id: 4, side: 'before' },
      { kind: 'node', id: 5, side: 'after' },
    ).ranges(context);

    const edges = extendSelection(
      { kind: 'node-selection', id: 6 },
      { kind: 'node-selection', id: 1 },
      context,
    );

    let rejected = false;

    try {
      createSelectionRegistry().read(context, {
        type: 'range',
        version: 1,
        data: { anchor: { kind: 'node', key: 'n-1', side: 'inside' }, head, upstream: false },
      });
    } catch {
      rejected = true;
    }

    return {
      ranges,
      reverse,
      restored: restored.anchor,
      after,
      undo,
      redo,
      whole,
      edges: edges.ranges(context),
      rejected,
    };
  })();

  expect(result.ranges).toEqual([
    { kind: 'node', id: 1 },
    { kind: 'node', id: 2 },
    { kind: 'node', id: 4 },
    { kind: 'text', id: 5, from: 0, to: 2 },
  ]);
  expect(result.reverse).toEqual(result.ranges);
  expect(result.restored).toEqual({ kind: 'node', id: 101, side: 'before' });
  expect(result.after).toEqual([
    {
      id: 3,
      key: 'n-3',
      kind: 'group',
      children: [{ id: 5, key: 'n-5', kind: 'text', value: 'Xil' }],
    },
    { id: 6, key: 'n-6', kind: 'atom' },
  ]);
  expect(result.undo && result.redo && result.rejected).toBe(true);
  expect(result.whole).toEqual([{ kind: 'node', id: 3 }]);
  expect(result.edges).toEqual([
    { kind: 'node', id: 1 },
    { kind: 'node', id: 2 },
    { kind: 'node', id: 3 },
    { kind: 'node', id: 6 },
  ]);
});

test('node edges follow split and join, and node-only ranges support replacement and gaps', async () => {
  const result = await (async () => {
    const { createEditor, RangeSelection, selectionContext } =
      await import('../src/state/index.ts');

    const { demoSchema } = await import('../src/extensions/demo-schema.ts');
    const { pasteFragment } = await import('../src/extensions/clipboard.ts');

    const p = (id, text) => ({
      kind: 'paragraph',
      id,
      key: `p-${id}`,
      text,
      marks: [],
      inline: [],
    });

    const image = (id) => ({ kind: 'image', id, key: `i-${id}`, src: 'data:,', alt: 'Image' });

    const editor = createEditor(
      demoSchema,
      [image(1), p(2, 'abcdef'), image(3)],
      new RangeSelection(
        { kind: 'node', id: 2, side: 'before' },
        { kind: 'node', id: 2, side: 'after' },
      ),
    );

    const dispatch = (steps) =>
      editor.dispatch({
        baseRevision: editor.state.revision,
        origin: 'local',
        history: 'separate',
        time: editor.state.revision,
        steps,
      });

    dispatch([{ kind: 'split', id: 2, at: 3, rightId: 4, rightKey: 'p-4' }]);
    const split = editor.state.selection.encode(selectionContext(demoSchema, editor.state.nodes));
    dispatch([{ kind: 'join', left: 2, right: 4 }]);
    const joined = editor.state.selection.head;
    editor.select(
      new RangeSelection(
        { kind: 'node', id: 1, side: 'before' },
        { kind: 'node', id: 1, side: 'after' },
      ),
    );
    let next = 10;
    const allocate = () => ({ id: next++, key: crypto.randomUUID() });

    const command = pasteFragment(
      demoSchema,
      editor.state,
      { inline: false, nodes: [p(99, 'replacement')] },
      allocate,
    );

    editor.dispatch({
      baseRevision: editor.state.revision,
      origin: 'local',
      history: 'separate',
      time: 10,
      ...command,
    });
    const replacement = editor.state.nodes.map((n) => (n.kind === 'paragraph' ? n.text : n.kind));
    editor.select(
      new RangeSelection(
        { kind: 'node', id: 3, side: 'after' },
        { kind: 'node', id: 3, side: 'after' },
      ),
    );

    const gap = pasteFragment(
      demoSchema,
      editor.state,
      { inline: false, nodes: [p(100, 'after')] },
      allocate,
    );

    editor.dispatch({
      baseRevision: editor.state.revision,
      origin: 'local',
      history: 'separate',
      time: 11,
      ...gap,
    });

    return { split, joined, replacement, gap: editor.state.nodes.at(-1).text };
  })();

  expect(result.split.data.head).toEqual({ kind: 'node', key: 'p-4', side: 'after' });
  expect(result.joined).toEqual({ kind: 'node', id: 2, side: 'after' });
  expect(result.replacement).toEqual(['replacement', 'abcdef', 'image']);
  expect(result.gap).toBe('after');
});

test('structural edits clean empty containers and keep surviving endpoints when an ancestor is deleted', async () => {
  const result = await (async () => {
    const { createEditor, RangeSelection, selectionContext } =
      await import('../src/state/index.ts');

    const { demoSchema } = await import('../src/extensions/demo-schema.ts');
    const { replaceStructuredText } = await import('../src/extensions/blocks.ts');

    const p = (id, text) => ({
      kind: 'paragraph',
      id,
      key: `p-${id}`,
      text,
      marks: [],
      inline: [],
    });

    const img = { kind: 'image', id: 3, key: 'image', src: 'data:,', alt: 'Image' };

    const nodes = [
      p(1, 'First'),
      { kind: 'quote', id: 2, key: 'quote', children: [img, p(4, 'Last')] },
      p(5, 'After'),
    ];

    const editor = createEditor(
      demoSchema,
      nodes,
      new RangeSelection(
        { kind: 'node', id: 3, side: 'before' },
        { kind: 'text', id: 5, offset: 2 },
      ),
    );

    const edit = replaceStructuredText(demoSchema, editor.state, 'X');
    editor.dispatch({ baseRevision: 0, origin: 'local', history: 'separate', time: 0, ...edit });
    const cleaned = editor.state.nodes.map((n) => (n.kind === 'paragraph' ? n.text : n.kind));
    editor.undo();
    editor.select(
      new RangeSelection(
        { kind: 'node', id: 3, side: 'before' },
        { kind: 'node', id: 5, side: 'after' },
      ),
    );
    editor.dispatch({
      baseRevision: editor.state.revision,
      origin: 'local',
      history: 'separate',
      time: 1,
      steps: [{ kind: 'removeChildren', parent: null, index: 1, count: 1 }],
    });

    return {
      cleaned,
      ranges: editor.state.selection.ranges(selectionContext(demoSchema, editor.state.nodes)),
    };
  })();

  expect(result.cleaned).toEqual(['First', 'Xter']);
  expect(result.ranges).toEqual([{ kind: 'node', id: 5 }]);
});

test('large node-only deletion batches siblings and undoes atomically', async () => {
  const result = await (async () => {
    const { schema } = await import('./fixtures/editor-foundation.js');
    const { createEditor, RangeSelection } = await import('../src/state/index.ts');

    const nodes = Array.from({ length: 1024 }, (_, id) => ({
      id,
      key: `atom-${id}`,
      kind: 'atom',
    }));

    const selection = new RangeSelection(
      { kind: 'node', id: 0, side: 'before' },
      { kind: 'node', id: 1023, side: 'after' },
    );

    const editor = createEditor(schema, nodes, selection),
      edit = editor.selectionEdit('');

    editor.dispatch({ baseRevision: 0, origin: 'local', history: 'separate', time: 0, ...edit });
    const count = editor.state.nodes.length;
    editor.undo();

    return {
      steps: edit.steps.length,
      count,
      restored: editor.state.nodes.length,
      selection: editor.state.selection.eq(selection),
    };
  })();

  expect(result).toEqual({ steps: 1, count: 0, restored: 1024, selection: true });
});
