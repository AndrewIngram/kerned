import { jsonNumber, createSchema, defineNode, type DocumentNode } from '@gprose/model';
import {
  createEditor,
  TextSelection,
  NodeSelection,
  AllSelection,
  textSelection,
  selectionContext,
  selectionMapping,
  createSelectionRegistry,
  type Selection,
} from '@gprose/state';
import { type Step } from '@gprose/transform';
import { z } from 'zod';

import { createCellSelectionExtension } from './extensions/cell-selection';

const textDefinition = defineNode({
  name: 'text',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

type AtomOptions = { selectable: boolean };

const atomOptions: AtomOptions = { selectable: true };

const atomDefinition = defineNode({
  name: 'atom',
  version: 1,
  options: atomOptions,
  schema: ({ selectable }) => ({
    selectable,
    attributes: z.strictObject({}),
    content: { kind: 'atom' },
  }),
});

type ContainerKind = 'table' | 'row' | 'cell' | 'group';

function containerDefinition(name: ContainerKind) {
  return defineNode({
    name,
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({
        colspan: z.number().int().positive(),
        rowspan: z.number().int().positive(),
      }),
      content: { kind: 'container', field: 'children' },
    }),
  });
}

const definitions = [
  textDefinition,
  atomDefinition,
  containerDefinition('table'),
  containerDefinition('row'),
  containerDefinition('cell'),
  containerDefinition('group'),
] as const;

type Node = DocumentNode<typeof definitions>;

const leaf = (id: number, text: string): Node => ({ id, key: `key-${id}`, kind: 'text', text });

const container = (
  id: number,
  kind: ContainerKind,
  children: Node[],
  colspan = 1,
  rowspan = 1,
): Node => ({ id, key: `key-${id}`, kind, children, colspan, rowspan });

const schema = createSchema({ extensions: definitions });

const tables = createCellSelectionExtension({
  rows(context, id) {
    const table = context.node(id);

    if (!table || !('kind' in table) || table.kind !== 'table') return null;

    return context.children(id).map((row) =>
      context.children(row.id).map((cell) => {
        if (!('colspan' in cell) || !('rowspan' in cell)) throw new Error('Not a cell');

        return {
          id: cell.id,
          colspan: jsonNumber(cell.colspan),
          rowspan: jsonNumber(cell.rowspan),
        };
      }),
    );
  },
});

export function checkSelections() {
  let assertions = 0;

  const check = (value: boolean, message: string) => {
    assertions++;

    if (!value) throw new Error(message);
  };

  const equal = <Value>(a: Value, b: Value, message: string) =>
    check(JSON.stringify(a) === JSON.stringify(b), message);

  const rejected = (fn: () => void, message: string) => {
    let failed = false;

    try {
      fn();
    } catch {
      failed = true;
    }

    check(failed, message);
  };

  const editor = createEditor<Node>(
    schema,
    [leaf(1, 'Alpha'), { id: 9, key: 'atom', kind: 'atom' }, leaf(2, 'Beta'), leaf(3, 'Gamma')],
    new TextSelection({ id: 1, offset: 2 }, { id: 2, offset: 2 }),
  );

  const context = () => selectionContext(schema, editor.state.nodes);

  function dispatch(steps: Step<Node>[], selection?: Selection) {
    return editor.dispatch({
      baseRevision: editor.state.revision,
      origin: 'local',
      history: 'separate',
      time: 0,
      steps,
      selection,
    });
  }

  equal(
    editor.state.selection.ranges(context()),
    [
      { kind: 'text', id: 1, from: 2, to: 5 },
      { kind: 'node', id: 9 },
      { kind: 'text', id: 2, from: 0, to: 2 },
    ],
    'Cross-block ranges include intervening atoms',
  );
  equal(
    editor.state.selection
      .content(context())
      .fragments.map((fragment) => (fragment.kind === 'text' ? fragment.text : fragment.node.key)),
    ['pha', 'atom', 'Be'],
    'Content extraction preserves disjoint fragments',
  );
  const backward = new TextSelection({ id: 2, offset: 2 }, { id: 1, offset: 2 });
  equal(
    backward.ranges(context()),
    editor.state.selection.ranges(context()),
    'Backward text selection covers same content',
  );
  check(!backward.eq(editor.state.selection), 'Direction remains part of identity');
  check(
    !editor.state.selection.isEmpty(context()) && textSelection(1, 0).isEmpty(context()),
    'Cursor and range emptiness',
  );
  const json = JSON.parse(JSON.stringify(editor.selectionJSON()));
  check(editor.readSelection(json).eq(editor.state.selection), 'Text codec round-trip');
  const edit = editor.selectionEdit('X');
  dispatch(edit.steps, edit.selection);
  equal(
    editor.state.nodes.map((node) => (node.kind === 'text' ? node.text : node.kind)),
    ['AlXta', 'Gamma'],
    'Cross-block replacement removes atom and joins text',
  );
  editor.undo();
  check(
    editor.state.selection instanceof TextSelection &&
      editor.state.selection.anchor.id === 1 &&
      editor.state.selection.head.id === 2,
    'Undo restores cross-block bookmark',
  );
  editor.redo();
  editor.undo();
  editor.select(textSelection(1, 1, 4));
  dispatch([{ kind: 'split', id: 1, at: 2, rightId: 4, rightKey: 'split' }]);
  check(
    editor.state.selection instanceof TextSelection &&
      editor.state.selection.anchor.id === 1 &&
      editor.state.selection.head.id === 4,
    'Split preserves endpoints in separate nodes',
  );
  editor.undo();
  editor.select(new NodeSelection(9));
  dispatch([
    { kind: 'moveChildren', parent: null, index: 1, count: 1, toParent: null, toIndex: 3 },
  ]);
  check(editor.state.selection.eq(new NodeSelection(9)), 'Node selection follows move');
  editor.undo();
  const nodeJSON = editor.selectionJSON();
  check(editor.readSelection(nodeJSON).eq(new NodeSelection(9)), 'Node codec');
  dispatch(editor.selectionEdit('').steps);
  check(editor.state.selection instanceof TextSelection, 'Deleted node falls back to text');
  editor.undo();
  check(editor.state.selection.eq(new NodeSelection(9)), 'Undo restores selected node');
  editor.select(new AllSelection());
  check(editor.readSelection(editor.selectionJSON()) instanceof AllSelection, 'All codec');
  const clear = editor.selectionEdit('');
  dispatch(clear.steps, clear.selection);
  check(
    editor.state.nodes.length === 0 && editor.state.selection instanceof AllSelection,
    'Empty document supports all selection',
  );
  editor.undo();
  check(
    editor.state.nodes.length === 4 && editor.state.selection instanceof AllSelection,
    'Whole-document undo',
  );

  const atomOnly = createEditor(
    schema,
    [{ id: 7, key: 'only', kind: 'atom' }],
    new NodeSelection(7),
  );

  const removal = atomOnly.selectionEdit('');
  atomOnly.dispatch({ baseRevision: 0, origin: 'local', history: 'separate', time: 0, ...removal });
  check(
    atomOnly.state.selection instanceof AllSelection,
    'Atom-only deletion needs no invented text node',
  );

  const twoAtoms = createEditor(
    schema,
    [
      { id: 7, key: 'a', kind: 'atom' },
      { id: 8, key: 'b', kind: 'atom' },
    ],
    new NodeSelection(7),
  );

  twoAtoms.dispatch({
    baseRevision: 0,
    origin: 'local',
    history: 'separate',
    time: 0,
    steps: twoAtoms.selectionEdit('').steps,
  });
  check(
    twoAtoms.state.selection.eq(new NodeSelection(8)),
    'Deleted node falls back to surviving atom',
  );

  const grouped = createEditor(
    schema,
    [container(60, 'group', [leaf(61, 'a')]), container(70, 'group', [leaf(71, 'b')])],
    new TextSelection({ id: 61, offset: 0 }, { id: 71, offset: 1 }),
  );

  const unchanged = grouped.state;
  rejected(
    () => grouped.selectionEdit('x'),
    'Cross-container replacement requires a schema command',
  );
  check(grouped.state === unchanged, 'Unsupported replacement does not mutate state');
  grouped.select(new NodeSelection(60));
  check(
    grouped.state.selection.content(selectionContext(schema, grouped.state.nodes)).fragments[0].node
      .id === 60,
    'Containers support node selection',
  );

  const unselectable = createSchema({
    extensions: [atomDefinition.configure({ selectable: false })],
  });

  rejected(
    () => createEditor(unselectable, [{ id: 7, key: 'only', kind: 'atom' }], new NodeSelection(7)),
    'Schema controls node selection',
  );

  for (const value of [
    null,
    {},
    { ...json, version: 2 },
    { ...json, type: 'missing' },
    {
      ...json,
      data: {
        anchor: { key: 'missing', offset: 0 },
        head: { key: 'key-1', offset: 0 },
        upstream: false,
      },
    },
  ])
    rejected(() => editor.readSelection(value), 'Malformed selection rejected');
  rejected(
    () => createSelectionRegistry([{ type: 'text', read: () => new AllSelection() }]),
    'Duplicate selection registration',
  );

  // Stable-key persistence resolves against new local handles.
  const freshNodes = [leaf(101, 'Alpha'), leaf(102, 'Beta')].map((node, i) => ({
    ...node,
    key: `key-${i + 1}`,
  }));

  const fresh = createEditor(schema, freshNodes, textSelection(101, 0));
  const restored = fresh.readSelection(json);
  check(
    restored instanceof TextSelection && restored.anchor.id === 101 && restored.head.id === 102,
    'Persisted selection uses keys, not handles',
  );

  // An isolated bookmark maps without a document and resolves after the change.
  const before = selectionContext(schema, [leaf(1, 'ab')]),
    after = selectionContext(schema, [leaf(1, 'aXb')]);

  const bookmark = textSelection(1, 1)
    .getBookmark()
    .map(
      selectionMapping(before, after, [{ kind: 'replace', id: 1, from: 1, to: 1, inserted: 1 }]),
    );

  check(bookmark.resolve(after).eq(textSelection(1, 2)), 'Bookmark maps and resolves');

  const table = container(10, 'table', [
    container(11, 'row', [
      container(21, 'cell', [leaf(31, 'A')]),
      container(22, 'cell', [leaf(32, 'B')]),
      container(23, 'cell', [leaf(33, 'C')]),
    ]),
    container(12, 'row', [
      container(24, 'cell', [leaf(34, 'D')]),
      container(25, 'cell', [leaf(35, 'E')]),
      container(26, 'cell', [leaf(36, 'F')]),
    ]),
  ]);

  const cellSelection = new tables.CellSelection(10, 21, 24);
  rejected(() => createEditor(schema, [table], cellSelection), 'Cell type requires registration');
  const cells = createEditor(schema, [table], cellSelection, [tables.extension]);
  const cellContext = () => selectionContext(schema, cells.state.nodes);
  check(!cellSelection.isEmpty(cellContext()), 'Cell selection is not a text cursor');
  equal(
    cellSelection.cells(cellContext()),
    [24, 21],
    'Rectangle selects disjoint first column with head first',
  );
  equal(
    cellSelection
      .content(cellContext())
      .fragments.map((fragment) => (fragment.kind === 'text' ? fragment.text : '')),
    ['D', 'A'],
    'Cell content excludes unrelated cells',
  );
  equal(
    cellSelection.ranges(cellContext()).map((range) => range.id),
    [34, 31],
    'Cell ranges exclude structurally intervening cells',
  );
  check(
    cells.readSelection(JSON.parse(JSON.stringify(cells.selectionJSON()))).eq(cellSelection),
    'Cell codec',
  );
  const replacement = cells.selectionEdit('Z');
  cells.dispatch({
    baseRevision: 0,
    origin: 'local',
    history: 'separate',
    time: 0,
    ...replacement,
  });
  equal(
    [31, 32, 33, 34, 35, 36].map((id) => cellContext().text(id)),
    ['', 'B', 'C', 'Z', 'E', 'F'],
    'Cell replacement inserts in head only and preserves unselected cells',
  );
  cells.undo();
  check(cells.state.selection.eq(cellSelection), 'Undo restores cell selection');
  cells.redo();
  cells.undo();
  const map = tables.grid(cellContext(), 10);
  check(tables.grid(cellContext(), 10) === map, 'Grid cached by table identity');
  cells.dispatch({
    baseRevision: cells.state.revision,
    origin: 'stream',
    history: 'exclude',
    steps: [{ kind: 'append', nodes: [leaf(50, 'stream')] }],
  });
  check(tables.grid(cellContext(), 10) === map, 'Unrelated streamed root does not invalidate grid');
  cells.select(new tables.CellSelection(10, 21, 24, 'column'));
  equal(
    cells.state.selection.ranges(cellContext()).map((range) => range.id),
    [34, 31],
    'Column extent',
  );
  cells.dispatch({
    baseRevision: cells.state.revision,
    origin: 'local',
    history: 'separate',
    time: 0,
    steps: [
      {
        kind: 'insertChildren',
        parent: 10,
        index: 2,
        nodes: [
          container(13, 'row', [
            container(27, 'cell', [leaf(37, 'G')]),
            container(28, 'cell', [leaf(38, 'H')]),
            container(29, 'cell', [leaf(39, 'I')]),
          ]),
        ],
      },
    ],
  });
  equal(
    cells.state.selection.ranges(cellContext()).map((range) => range.id),
    [34, 31, 37],
    'Column selection includes inserted row',
  );
  cells.undo();
  cells.select(cellSelection);
  cells.dispatch({
    baseRevision: cells.state.revision,
    origin: 'local',
    history: 'separate',
    time: 0,
    steps: [{ kind: 'removeChildren', parent: null, index: 0, count: 1 }],
  });
  check(cells.state.selection instanceof TextSelection, 'Removed table selection falls back');
  cells.undo();
  check(cells.state.selection.eq(cellSelection), 'Undo recovers table bookmark');

  const spanning = container(100, 'table', [
    container(101, 'row', [
      container(110, 'cell', [leaf(120, 'span')], 2, 2),
      container(111, 'cell', [leaf(121, 'top')]),
    ]),
    container(102, 'row', [container(112, 'cell', [leaf(122, 'bottom')])]),
  ]);

  const spanContext = selectionContext(schema, [spanning]),
    span = new tables.CellSelection(100, 110, 112);

  equal(span.cells(spanContext), [112, 110, 111], 'Spanning cells appear once');
  equal(
    [...tables.grid(spanContext, 100).slots],
    [0, 0, 1, 0, 0, 2],
    'Packed grid repeats spanning cell indexes',
  );
  rejected(
    () => new tables.CellSelection(10, 21, 112).validate(cellContext()),
    'Different-table endpoints rejected',
  );

  const broken = container(200, 'table', [
    container(201, 'row', [container(210, 'cell', [leaf(220, 'x')], 2)]),
    container(202, 'row', [container(211, 'cell', [leaf(221, 'y')])]),
  ]);

  rejected(() => tables.grid(selectionContext(schema, [broken]), 200), 'Ragged grid rejected');

  return { assertions, checks: 'passed' };
}
