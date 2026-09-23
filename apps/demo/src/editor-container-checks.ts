import { createListCommands, type ListCommand } from '@kerned/extension-editing';
import {
  createSchema,
  defineNode,
  indexTree,
  type NodeIdentity,
  type DocumentNode,
} from '@kerned/model';
import {
  textSelection,
  TextSelection,
  createEditor,
  createAnchor,
  resolveAnchor,
} from '@kerned/state';
import { type Step } from '@kerned/transform';
import { z } from 'zod';

const definitions = [
  defineNode({
    name: 'text',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({ value: z.string() }),
      content: { kind: 'text', field: 'value' },
    }),
  }),
  defineNode({
    name: 'group',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({}),
      content: { kind: 'container', field: 'children' },
    }),
  }),
  defineNode({
    name: 'list',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({ ordered: z.boolean(), start: z.number().int().positive() }),
      content: { kind: 'container', field: 'children', allowed: ['item'], minChildren: 1 },
    }),
  }),
  defineNode({
    name: 'item',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({}),
      content: {
        kind: 'container',
        field: 'children',
        allowed: ['text', 'list'],
        first: ['text'],
        parents: ['list'],
        minChildren: 1,
      },
    }),
  }),
] as const;

const schema = createSchema({ extensions: definitions });

type Node = DocumentNode<typeof definitions>;

type Text = Extract<Node, { kind: 'text' }>;

type Group = Extract<Node, { kind: 'group' }>;

function text(node: Node): Text {
  if (node.kind !== 'text') throw new Error('Text required');

  return node;
}

const lists = createListCommands<Node>({
  list: (n) => (n.kind === 'list' ? n : null),
  item: (n) => (n.kind === 'item' ? n : null),
  isBlock: (n) => n.kind === 'text',
  createList: (identity, settings) => ({ ...identity, kind: 'list', ...settings, children: [] }),
  createItem: (identity) => ({ ...identity, kind: 'item', children: [] }),
});

const leaf = (id: number, value: string): Text => ({ id, key: `text-${id}`, kind: 'text', value });

export function checkContainers() {
  let assertions = 0,
    sequence = 100;

  const allocate = (): NodeIdentity => {
    const id = sequence++;

    return { id, key: `allocated-${id}` };
  };

  function check(value: boolean, message: string) {
    assertions++;

    if (!value) throw new Error(message);
  }

  function equal<Value>(a: Value, b: Value, message: string) {
    check(JSON.stringify(a) === JSON.stringify(b), message);
  }

  const editor = createEditor(
    schema,
    [leaf(1, 'Alpha'), leaf(2, 'Beta'), leaf(3, 'Gamma')],
    textSelection(2, 2, 2),
  );

  const anchor = createAnchor(schema, editor.state, 'doc', 2, 2, 1);

  function apply(command: ListCommand<Node>) {
    return editor.dispatch({
      baseRevision: editor.state.revision,
      origin: 'local',
      history: 'separate',
      time: editor.state.revision,
      steps: command.steps,
      selection: command.selection,
    });
  }

  function roundTrip(command: ListCommand<Node>, label: string) {
    const before = editor.state.nodes;
    apply(command);
    const after = editor.state.nodes;
    editor.undo();
    equal(editor.state.nodes, before, `${label} undo`);
    editor.redo();
    equal(editor.state.nodes, after, `${label} redo`);
  }

  roundTrip(
    lists.wrap(schema, editor.state, null, 0, 3, { ordered: true, start: 4 }, allocate),
    'List wrap',
  );
  equal(
    lists.markers(schema, editor.state.nodes).map((m) => m.label),
    ['4.', '5.', '6.'],
    'Numbering starts at configured value',
  );

  let tree = indexTree(schema, editor.state.nodes),
    beta = tree.byId.get(2);

  if (!beta || beta.parent === null) throw new Error('Missing beta item');
  const betaItem = beta.parent;
  roundTrip(lists.indent(schema, editor.state, betaItem, allocate), 'Indent');
  check(
    lists.markers(schema, editor.state.nodes).some((m) => m.id === betaItem && m.depth === 1),
    'Nested marker depth',
  );

  const resolved = resolveAnchor(
    schema,
    JSON.parse(JSON.stringify(anchor)),
    'doc',
    editor.state,
    JSON.parse(JSON.stringify(editor.journal)),
  );

  check(
    resolved.status === 'resolved' &&
      resolved.anchor.blockKey === 'text-2' &&
      resolved.anchor.offset === 2,
    'Saved reference follows nesting',
  );
  roundTrip(lists.outdent(schema, editor.state, betaItem, allocate), 'Outdent');
  roundTrip(lists.enter(schema, editor.state, 2, 2, allocate), 'Split list item');

  const right =
    editor.state.selection instanceof TextSelection ? editor.state.selection.head.id : -1;

  check(
    text(indexTree(schema, editor.state.nodes).byId.get(right)?.node ?? leaf(0, '')).value === 'ta',
    'Enter moves trailing text',
  );
  roundTrip(lists.backspace(schema, editor.state, right, allocate), 'Join list items');
  check(
    text(indexTree(schema, editor.state.nodes).byId.get(2)?.node ?? leaf(0, '')).value === 'Beta',
    'Backspace restores text',
  );
  roundTrip(
    lists.outdent(schema, editor.state, betaItem, allocate),
    'Lift middle item between lists',
  );
  equal(
    editor.state.nodes.map((n) => n.kind),
    ['list', 'text', 'list'],
    'Lift splits surrounding list',
  );
  equal(
    lists.markers(schema, editor.state.nodes).map((m) => m.label),
    ['4.', '6.'],
    'Following numbering is preserved',
  );
  // Move a text node through unrelated generic containers; no list semantics in core.
  const group: Group = { ...allocate(), kind: 'group', children: [] };
  roundTrip(
    { steps: [{ kind: 'wrapChildren', parent: null, index: 1, count: 1, wrapper: group }] },
    'Generic wrap',
  );
  roundTrip({ steps: [{ kind: 'unwrap', id: group.id }] }, 'Generic unwrap');
  const second = leaf(8, 'Outside');
  roundTrip(
    { steps: [{ kind: 'insertChildren', parent: null, index: 1, nodes: [second] }] },
    'Insert child',
  );
  roundTrip(
    {
      steps: [
        { kind: 'moveChildren', parent: null, index: 1, count: 1, toParent: null, toIndex: 3 },
      ],
    },
    'Move sibling',
  );

  const beforeRemoval = createAnchor(schema, editor.state, 'doc', 8, 1, 1),
    entry = indexTree(schema, editor.state.nodes).byId.get(8);

  if (!entry) throw new Error('Missing inserted child');
  roundTrip(
    { steps: [{ kind: 'removeChildren', parent: entry.parent, index: entry.index, count: 1 }] },
    'Remove child',
  );
  check(
    resolveAnchor(schema, beforeRemoval, 'doc', editor.state, editor.journal).status === 'deleted',
    'Removed subtree reference is deleted',
  );
  // Structural undo must leave arrivals untouched.
  const block = leaf(9, 'Streamed');
  editor.dispatch({
    baseRevision: editor.state.revision,
    origin: 'stream',
    history: 'exclude',
    steps: [{ kind: 'append', nodes: [block] }],
  });
  editor.undo();
  check(editor.state.nodes.at(-1) === block, 'Undo preserves streamed roots');
  editor.redo();
  check(editor.state.nodes.at(-1) === block, 'Redo preserves streamed roots');

  // Invalid cycles, duplicate identities and schema violations fail atomically.
  const invalid: Step<Node>[][] = [
    [{ kind: 'insertChildren', parent: null, index: 0, nodes: [leaf(2, 'Duplicate')] }],
    [
      {
        kind: 'replaceChildren',
        parent: null,
        index: 1,
        count: 1,
        nodes: [leaf(2, 'Changed without text mapping')],
      },
    ],
    [
      {
        kind: 'moveChildren',
        parent: null,
        index: 0,
        count: 1,
        toParent: editor.state.nodes[0].id,
        toIndex: 0,
      },
    ],
    [
      {
        kind: 'insertChildren',
        parent: editor.state.nodes[0].id,
        index: 0,
        nodes: [leaf(50, 'Not an item')],
      },
    ],
    [
      {
        kind: 'insertChildren',
        parent: null,
        index: 0,
        nodes: [{ ...allocate(), kind: 'item', children: [leaf(51, 'Orphan')] }],
      },
    ],
  ];

  for (const steps of invalid) {
    const before = editor.state,
      history = editor.history;

    let rejected = false;

    try {
      apply({ steps });
    } catch {
      rejected = true;
    }

    check(rejected && editor.state === before, 'Invalid structural transaction is atomic');
    equal(editor.history, history, 'Failure preserves history');
  }

  // Empty-item Enter leaves the list but preserves the text identity and caret.
  const empty = createEditor(schema, [leaf(60, '')], textSelection(60, 0, 0));

  function emptyApply(command: ListCommand<Node>) {
    empty.dispatch({
      baseRevision: empty.state.revision,
      origin: 'local',
      history: 'separate',
      time: 0,
      ...command,
    });
  }

  emptyApply(lists.wrap(schema, empty.state, null, 0, 1, { ordered: false, start: 1 }, allocate));
  emptyApply(lists.enter(schema, empty.state, 60, 0, allocate));
  equal(empty.state.nodes, [leaf(60, '')], 'Empty item exits list');

  // Multiple nesting levels and mixed ordered/bullet lists retain identities.
  const deep = createEditor(
    schema,
    [leaf(91, 'One'), leaf(92, 'Two'), leaf(93, 'Three')],
    textSelection(93, 1, 1),
  );

  function deepApply(command: ListCommand<Node>) {
    deep.dispatch({
      baseRevision: deep.state.revision,
      origin: 'local',
      history: 'separate',
      time: 0,
      ...command,
    });
  }

  const deepAnchor = createAnchor(schema, deep.state, 'deep', 93, 1, -1);
  deepApply(lists.wrap(schema, deep.state, null, 0, 3, { ordered: false, start: 1 }, allocate));

  const itemOf = (id: number) => {
    const parent = indexTree(schema, deep.state.nodes).byId.get(id)?.parent;

    if (parent === null || parent === undefined) throw new Error('Expected parent');

    return parent;
  };

  deepApply(lists.indent(schema, deep.state, itemOf(93), allocate));
  deepApply(lists.indent(schema, deep.state, itemOf(92), allocate));
  check(
    lists
      .markers(schema, deep.state.nodes)
      .some((m) => m.id === itemOf(93) && m.depth === 2 && m.label === '•'),
    'Two levels of bullet nesting',
  );
  const nestedParent = indexTree(schema, deep.state.nodes).byId.get(itemOf(93))?.parent;

  const nestedList =
    nestedParent === null || nestedParent === undefined
      ? undefined
      : indexTree(schema, deep.state.nodes).byId.get(nestedParent)?.node;

  if (nestedList?.kind !== 'list') throw new Error('Expected nested list');
  deepApply({ steps: [{ kind: 'updateBlock', node: { ...nestedList, ordered: true, start: 7 } }] });
  check(
    lists.markers(schema, deep.state.nodes).some((m) => m.label === '7.' && m.depth === 2),
    'Mixed nested numbering',
  );
  deepApply(lists.outdent(schema, deep.state, itemOf(93), allocate));
  const deepResolved = resolveAnchor(schema, deepAnchor, 'deep', deep.state, deep.journal);
  check(
    deepResolved.status === 'resolved' && deepResolved.anchor.offset === 1,
    'Anchor survives deep reparenting',
  );

  // Disjoint targets can be edited as a batch without selecting a contiguous tree interval.
  const cells = createEditor(
    schema,
    [
      { id: 70, key: 'row-a', kind: 'group', children: [leaf(71, 'A'), leaf(72, 'B')] },
      { id: 80, key: 'row-b', kind: 'group', children: [leaf(81, 'C'), leaf(82, 'D')] },
    ],
    textSelection(71, 0, 0),
  );

  cells.dispatch({
    baseRevision: 0,
    origin: 'local',
    history: 'separate',
    time: 0,
    steps: [
      { kind: 'replaceText', id: 71, from: 0, to: 1, text: 'X' },
      { kind: 'replaceText', id: 81, from: 0, to: 1, text: 'Y' },
    ],
  });
  equal(
    indexTree(schema, cells.state.nodes).order.flatMap((e) =>
      e.node.kind === 'text' ? [e.node.value] : [],
    ),
    ['X', 'B', 'Y', 'D'],
    'Disjoint edits preserve intervening nodes',
  );
  cells.undo();
  equal(
    indexTree(schema, cells.state.nodes).order.flatMap((e) =>
      e.node.kind === 'text' ? [e.node.value] : [],
    ),
    ['A', 'B', 'C', 'D'],
    'Disjoint edit is one undo action',
  );

  for (const count of [2000, 10000]) {
    const initial = Array.from({ length: count }, (_, i) => leaf(i + 1000, `Item ${i}`));
    const bulk = createEditor(schema, initial, textSelection(1000, 0, 0));
    let next = count + 2000;
    const ids = () => ({ id: next, key: `bulk-${next++}` });

    const command = lists.wrap(
      schema,
      bulk.state,
      null,
      0,
      count,
      { ordered: true, start: 1 },
      ids,
    );

    check(command.steps.length === 1, 'Bulk list wrap is one structural operation');
    bulk.dispatch({ baseRevision: 0, origin: 'local', history: 'separate', time: 0, ...command });
    const markers = lists.markers(schema, bulk.state.nodes);
    check(markers.length === count && markers.at(-1)?.label === `${count}.`, 'Bulk numbering');
    bulk.undo();
    equal(bulk.state.nodes, initial, 'Bulk list wrap undo');
  }

  return { assertions, checks: 'passed', markers: lists.markers(schema, editor.state.nodes) };
}

/** Measures transaction application itself, before React/layout work. */
export function benchmarkContainerEdits() {
  const results = [];

  for (const count of [2000, 10000])
    for (const nested of [false, true]) {
      const leaves = Array.from({ length: count }, (_, i) =>
        leaf(i + 1, `Block ${i}: editable content.`),
      );

      const nodes: Node[] = nested
        ? [{ id: count + 1, key: 'benchmark-container', kind: 'group', children: leaves }]
        : leaves;

      const editor = createEditor(schema, nodes, textSelection(Math.floor(count / 2), 0, 0));
      const samples: number[] = [];

      for (let trial = -3; trial < 20; trial++) {
        const started = performance.now();
        editor.dispatch({
          baseRevision: editor.state.revision,
          origin: 'local',
          history: 'separate',
          time: trial,
          steps: [
            {
              kind: 'replaceText',
              id: Math.floor(count / 2),
              from: 0,
              to: 1,
              text: trial % 2 ? 'A' : 'B',
            },
          ],
        });
        const elapsed = performance.now() - started;

        if (trial >= 0) samples.push(elapsed);
      }

      const sorted = [...samples].toSorted((a, b) => a - b);
      results.push({
        count,
        nested,
        medianMs: (sorted[9] + sorted[10]) / 2,
        p95Ms: sorted[18],
        samples,
      });
    }

  return results;
}
