import { test, expect } from 'vitest';

import * as commentModule from '../src/extensions/comment.ts';
import * as modelModule from '../src/model/index.ts';
import * as stateModule from '../src/state/index.ts';
import * as editorFoundationModule from './fixtures/editor-foundation.js';

test('durable mixed ranges survive nested edits, deletion, undo and checkpoint reload without registration', async () => {
  const result = await (async () => {
    const { schema, dispatch } = editorFoundationModule;

    const { createEditor, RangeSelection, NodeSelection, parseDocumentRange, textSelection } =
      Object.assign({}, stateModule, modelModule);

    const { captureComment, commentDecorations } = commentModule;
    const { resolveRangeDecorations } = stateModule;

    const atom = (id) => ({ id, key: `n-${id}`, kind: 'atom' }),
      text = (id, value) => ({ id, key: `n-${id}`, kind: 'text', value });

    const nodes = [
      text(1, 'Outside'),
      atom(2),
      { id: 3, key: 'n-3', kind: 'group', children: [text(4, 'Middle'), atom(5)] },
      text(6, 'Tail'),
      atom(7),
    ];

    const editor = createEditor(
      schema,
      nodes,
      new RangeSelection(
        { kind: 'node', id: 2, side: 'before' },
        { kind: 'text', id: 6, offset: 2 },
      ),
      [],
      { documentId: 'mixed' },
    );

    const checkpointBefore = JSON.stringify(editor.positions.checkpoint());
    const comment = captureComment(editor, 'c', [{ body: 'Review' }]);
    const range = parseDocumentRange(JSON.parse(JSON.stringify(comment.range)));
    const unregistered = checkpointBefore === JSON.stringify(editor.positions.checkpoint());
    const resolve = () => editor.positions.resolveDocumentRange(range);
    const initial = resolve();
    dispatch(editor, [{ kind: 'insertChildren', parent: 3, index: 1, nodes: [text(8, 'Added')] }]);
    const insertion = resolve();
    dispatch(editor, [{ kind: 'removeChildren', parent: null, index: 1, count: 1 }]);
    const deletedStart = resolve();
    dispatch(editor, [{ kind: 'unwrap', id: 3 }]);
    const unwrapped = resolve();
    dispatch(editor, [{ kind: 'split', id: 6, at: 1, rightId: 9, rightKey: 'n-9' }]);
    const split = resolve();
    const checkpoint = JSON.parse(JSON.stringify(editor.positions.checkpoint()));

    const remap = (node) => {
      const resultValue = { ...node, id: node.id + 100 };

      if (node.children) resultValue.children = node.children.map(remap);

      return resultValue;
    };

    const loaded = createEditor(schema, editor.state.nodes.map(remap), textSelection(101, 0), [], {
      documentId: 'mixed',
      revision: editor.state.revision,
      positionCheckpoint: checkpoint,
    });

    const reloaded = loaded.positions.resolveDocumentRange(range);
    const decorations = resolveRangeDecorations(commentDecorations([comment]), editor.positions);
    editor.undo();
    editor.undo();
    editor.undo();
    editor.undo();
    const undo = resolve();
    // A node comment becomes deleted, not attached to the next paragraph.
    editor.select(new NodeSelection(2));
    const nodeRange = editor.positions.captureRange(editor.state.selection);
    dispatch(editor, [{ kind: 'removeChildren', parent: null, index: 1, count: 1 }]);
    const deleted = editor.positions.resolveDocumentRange(nodeRange);
    editor.undo();
    const restored = editor.positions.resolveDocumentRange(nodeRange);
    let malformed = false;

    try {
      parseDocumentRange({ ...range, end: { ...range.end, documentId: 'other' } });
    } catch {
      malformed = true;
    }

    return {
      initial,
      insertion,
      deletedStart,
      unwrapped,
      split,
      reloaded,
      decorations: decorations.resolved.length,
      undo,
      deleted,
      restored,
      unregistered,
      malformed,
    };
  })();

  expect(result.unregistered && result.malformed).toBe(true);
  expect(result.initial.ranges).toEqual([
    { kind: 'node', id: 2 },
    { kind: 'node', id: 3 },
    { kind: 'text', id: 6, from: 0, to: 2 },
  ]);
  expect(result.insertion.ranges).toEqual(result.initial.ranges);
  expect(result.deletedStart.ranges).toEqual([
    { kind: 'node', id: 3 },
    { kind: 'text', id: 6, from: 0, to: 2 },
  ]);
  expect(result.unwrapped.ranges).toEqual([
    { kind: 'node', id: 4 },
    { kind: 'node', id: 8 },
    { kind: 'node', id: 5 },
    { kind: 'text', id: 6, from: 0, to: 2 },
  ]);
  expect(result.split.ranges.at(-1)).toEqual({ kind: 'text', id: 9, from: 0, to: 1 });
  expect(result.reloaded.ranges).toEqual(
    result.split.ranges.map((r) => ({ ...r, id: r.id + 100 })),
  );
  expect(result.decorations).toBe(1);
  expect(result.undo).toEqual(result.initial);
  expect(result.deleted.status).toBe('deleted');
  expect(result.restored.ranges).toEqual([{ kind: 'node', id: 2 }]);
});

test('node boundaries follow split, join, moves and unwrap with inward deletion semantics', async () => {
  const result = await (async () => {
    const { schema, dispatch } = editorFoundationModule;
    const { createEditor, NodeSelection, RangeSelection } = stateModule;

    const t = (id, value) => ({ id, key: `n-${id}`, kind: 'text', value }),
      a = (id) => ({ id, key: `n-${id}`, kind: 'atom' });

    const editor = createEditor(schema, [a(1), t(2, 'abcdef'), a(3), a(4)], new NodeSelection(2));
    const text = editor.positions.captureRange(editor.state.selection);
    dispatch(editor, [{ kind: 'split', id: 2, at: 3, rightId: 5, rightKey: 'n-5' }]);
    const split = editor.positions.resolveDocumentRange(text);
    dispatch(editor, [{ kind: 'join', left: 2, right: 5 }]);
    const joined = editor.positions.resolveDocumentRange(text);
    editor.select(new NodeSelection(3));
    const moved = editor.positions.captureRange(editor.state.selection);
    dispatch(editor, [
      { kind: 'moveChildren', parent: null, index: 2, count: 1, toParent: null, toIndex: 0 },
    ]);
    const move = editor.positions.resolveDocumentRange(moved);
    editor.select(
      new RangeSelection(
        { kind: 'node', id: 1, side: 'before' },
        { kind: 'node', id: 4, side: 'after' },
      ),
    );
    const range = editor.positions.captureRange(editor.state.selection);
    dispatch(editor, [
      { kind: 'removeChildren', parent: null, index: 3, count: 1 },
      { kind: 'removeChildren', parent: null, index: 1, count: 1 },
    ]);
    const bothDeleted = editor.positions.resolveDocumentRange(range);

    return { split, joined, move, bothDeleted };
  })();

  expect(result.split.ranges).toEqual([
    { kind: 'node', id: 2 },
    { kind: 'node', id: 5 },
  ]);
  expect(result.joined.ranges).toEqual([{ kind: 'node', id: 2 }]);
  expect(result.move.ranges).toEqual([{ kind: 'node', id: 3 }]);
  expect(result.bothDeleted.ranges).toEqual([{ kind: 'node', id: 2 }]);
});

test('external ranges resolve identically across replicas after accepted edits and container unwrap', async () => {
  const result = await (async () => {
    const { schema, dispatch } = editorFoundationModule;

    const { createEditor, NodeSelection, RangeSelection, parseDocumentRange } = Object.assign(
      {},
      stateModule,
      modelModule,
    );

    const t = (id, value) => ({ id, key: `n-${id}`, kind: 'text', value }),
      a = (id) => ({ id, key: `n-${id}`, kind: 'atom' });

    const nodes = [
      { id: 1, key: 'n-1', kind: 'group', children: [t(2, 'Alpha'), a(3), t(4, 'Omega')] },
    ];

    const left = createEditor(schema, nodes, new NodeSelection(1), [], { documentId: 'shared' });

    const right = createEditor(schema, structuredClone(nodes), new NodeSelection(1), [], {
      documentId: 'shared',
    });

    const range = parseDocumentRange(
      JSON.parse(JSON.stringify(left.positions.captureRange(left.state.selection))),
    );

    const changes = [
      [{ kind: 'replaceText', id: 2, from: 2, to: 2, text: ' by Alice ' }],
      [{ kind: 'insertChildren', parent: 1, index: 2, nodes: [a(5)] }],
      [{ kind: 'unwrap', id: 1 }],
    ];

    for (const steps of changes) {
      dispatch(left, steps);
      dispatch(right, structuredClone(steps));
    }

    const aResult = left.positions.resolveDocumentRange(range),
      bResult = right.positions.resolveDocumentRange(range);

    left.select(
      new RangeSelection(
        { kind: 'text', id: 2, offset: 2 },
        { kind: 'node', id: 3, side: 'after' },
      ),
    );
    const partial = left.positions.captureRange(left.state.selection);
    dispatch(left, [
      { kind: 'replaceText', id: 2, from: 2, to: 2, text: 'outside' },
      { kind: 'replaceText', id: 2, from: 12, to: 12, text: 'inside' },
    ]);
    const affinity = left.positions.resolveDocumentRange(partial);
    dispatch(left, [
      {
        kind: 'replaceRanges',
        ranges: [
          { kind: 'text', id: 2, from: 9, to: left.state.nodes[0].value.length },
          { kind: 'node', id: 3 },
        ],
        text: '',
        pruneEmpty: [],
      },
    ]);
    const removed = left.positions.resolveDocumentRange(partial);
    left.undo();
    const undo = left.positions.resolveDocumentRange(partial);

    return { aResult, bResult, affinity, removed, undo };
  })();

  expect(result.aResult).toEqual(result.bResult);
  expect(result.aResult.ranges).toEqual([
    { kind: 'node', id: 2 },
    { kind: 'node', id: 3 },
    { kind: 'node', id: 5 },
    { kind: 'node', id: 4 },
  ]);
  expect(result.affinity.ranges[0].from).toBe(9);
  expect(result.affinity.ranges.at(-1)).toEqual({ kind: 'node', id: 3 });
  expect(result.removed.status).toBe('deleted');
  expect(result.undo).toEqual(result.affinity);
});

test('text endpoints retain an interior atom after both endpoint paragraphs are removed', async () => {
  const result = await (async () => {
    const { schema, dispatch } = editorFoundationModule;
    const { createEditor, TextSelection } = stateModule;

    const nodes = [
      { id: 1, key: 'a', kind: 'text', value: 'First' },
      { id: 2, key: 'b', kind: 'atom' },
      { id: 3, key: 'c', kind: 'text', value: 'Last' },
    ];

    const editor = createEditor(
      schema,
      nodes,
      new TextSelection({ id: 1, offset: 2 }, { id: 3, offset: 2 }),
    );

    const range = editor.positions.captureRange(editor.state.selection);
    dispatch(editor, [
      { kind: 'removeChildren', parent: null, index: 2, count: 1 },
      { kind: 'removeChildren', parent: null, index: 0, count: 1 },
    ]);
    const surviving = editor.positions.resolveDocumentRange(range);
    dispatch(editor, [{ kind: 'removeChildren', parent: null, index: 0, count: 1 }]);
    const deleted = editor.positions.resolveDocumentRange(range);
    editor.undo();
    const undo = editor.positions.resolveDocumentRange(range);

    return { surviving, deleted, undo };
  })();

  expect(result.surviving).toEqual({ status: 'resolved', ranges: [{ kind: 'node', id: 2 }] });
  expect(result.deleted.status).toBe('deleted');
  expect(result.undo).toEqual(result.surviving);
});
