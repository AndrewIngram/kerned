import { test, expect } from 'vitest';

test('starter commands target the selected node and disjoint cells, never the first paragraph', async () => {
  const result = await (async () => {
    const { React, createRoot, flushSync } = await import('./fixtures/selection-probe.js');

    const { NodeSelection, textSelection, selectionContext } =
      await import('../src/state/index.ts');

    const { demoSchema } = await import('../src/extensions/demo-schema.ts');
    const { createTable, tableCells } = await import('../src/extensions/table.ts');

    const { createEditor } = await import('../src/core/index.ts');
    const { createSchema } = await import('../src/model/index.ts');
    const { starterExtensions } = await import('../src/extensions/starter-kit/index.ts');
    const { starterInput } = await import('../src/extensions/starter-kit/browser.ts');
    const { useEditorState } = await import('../src/editor-react/index.tsx');

    const { createStarterDocumentQuery } =
      await import('../src/extensions/starter-kit/browser-document.ts');

    const { createStarterKitInput } = await import('../src/extensions/starter-kit/input.ts');
    const { createTextInput } = await import('../src/editor-browser/text-input.ts');
    let next = 10;
    const allocate = () => ({ id: next++, key: crypto.randomUUID() });

    const paragraph = (id, text) => ({
      id,
      key: `p-${id}`,
      kind: 'paragraph',
      text,
      marks: [],
      inline: [],
    });

    const table = structuredClone(createTable(demoSchema, allocate));

    const editor = createEditor({
      schema: createSchema({ extensions: [...starterExtensions, starterInput] }),
      document: [
        paragraph(1, 'First'),
        { id: 2, key: 'image', kind: 'image', src: '', alt: 'Image' },
        table,
      ],
      selection: textSelection(1, 2),
    });

    let doc;
    const projectDocument = createStarterDocumentQuery(editor.schema);

    function Probe() {
      const nextDocument = useEditorState(editor, projectDocument);
      React.useLayoutEffect(() => {
        doc = nextDocument;
      }, [nextDocument]);

      return null;
    }

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    flushSync(() => root.render(React.createElement(Probe)));
    const notices = [];

    const input = document.createElement('textarea'),
      capture = createTextInput(demoSchema, editor);

    capture.sync(input);
    flushSync(() => editor.select(new NodeSelection(2)));
    capture.sync(input);

    const node = {
      targets: doc.selectedBlocks.map((n) => n.id),
      focus: doc.active.id,
      input: input.value,
      text: doc.textSelection,
    };

    flushSync(() => editor.commands.setHeading(2));
    const firstAfterHeading = editor.state.nodes[0].kind;
    const clipboard = new DataTransfer();

    const { events } = createStarterKitInput({
      editor,
      onEdit() {},
      textInput: capture,
      input: () => input,
      notice: (m) => notices.push(m),
      closePanel() {},
      escape() {},
      selectAll() {},
      navigate() {
        return false;
      },
    });

    flushSync(() => events.cut({ preventDefault() {}, clipboardData: clipboard }));

    const cut = {
      text: clipboard.getData('text/plain'),
      first: editor.state.nodes[0].text,
      image: editor.state.nodes.some((n) => n.id === 2),
    };

    flushSync(() => editor.commands.undo());
    flushSync(() => editor.commands.insertTable());
    const order = editor.state.nodes.map((n) => n.kind);
    const { TextSelection } = await import('../src/state/index.ts');

    const insertedTable = editor.state.nodes[2],
      after = editor.state.nodes[3];

    flushSync(() =>
      editor.select(new TextSelection({ id: 1, offset: 0 }, { id: after.id, offset: 0 })),
    );

    const spanning = {
      targets: doc.selectedBlocks.map((n) => n.kind),
      table: doc.selectedRange(insertedTable),
    };

    flushSync(() =>
      editor.select(
        new tableCells.CellSelection(table.id, table.rows[0][0].id, table.rows[1][0].id),
      ),
    );
    const context = selectionContext(demoSchema, editor.state.nodes);
    const expected = editor.state.selection.ranges(context).map((r) => r.id);
    const targets = doc.selectedBlocks.map((n) => n.id);
    flushSync(() => editor.commands.setHeading(3));
    const updated = selectionContext(demoSchema, editor.state.nodes);
    const selectedKinds = expected.map((id) => updated.node(id).kind);
    const untouched = updated.node(table.rows[0][1].paragraphs[0].id).kind;
    flushSync(() => editor.select(new NodeSelection(2)));
    flushSync(() => editor.commands.replaceSelection('Replacement'));
    const replacement = editor.state.nodes.map((n) => ({ kind: n.kind, text: n.text }));
    root.unmount();
    host.remove();

    return {
      node,
      cut,
      spanning,
      firstAfterHeading,
      order,
      expected,
      targets,
      selectedKinds,
      untouched,
      replacement,
      errors: notices.filter(Boolean),
    };
  })();

  expect(result.node).toEqual({ targets: [2], focus: 2, input: '', text: null });
  expect(result.cut).toEqual({ text: 'Image', first: 'First', image: false });
  expect(result.firstAfterHeading).toBe('paragraph');
  expect(result.order.slice(0, 4)).toEqual(['paragraph', 'image', 'table', 'paragraph']);
  expect(result.spanning).toEqual({
    targets: ['paragraph', 'image', 'table'],
    table: { from: 0, to: 1 },
  });
  expect(result.targets).toEqual(result.expected);
  expect(result.selectedKinds.every((kind) => kind === 'heading')).toBe(true);
  expect(result.untouched).toBe('paragraph');
  expect(result.replacement[0]).toEqual({ kind: 'paragraph', text: 'First' });
  expect(result.replacement[1]).toEqual({ kind: 'paragraph', text: 'Replacement' });
  expect(result.errors).toEqual([]);
});
