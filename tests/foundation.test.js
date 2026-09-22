import * as commentModule from '@gprose/extension-comments';
import * as cellSelectionModule from '@gprose/extension-table';
import * as modelModule from '@gprose/model';
import * as stateModule from '@gprose/state';
import * as transformModule from '@gprose/transform';
import { test, expect } from 'vitest';

import * as headingsModule from '../packages/extension-editing/src/headings.js';
import * as demoSchemaModule from '../src/demo/demo-schema.js';
import * as editorFoundationModule from './fixtures/editor-foundation.js';
import * as replayPositionsModule from './fixtures/replay-positions.js';

test('nested text selection and non-contiguous table cells', async () => {
  const result = await (async () => {
    const { fixture, schema } = editorFoundationModule;
    const { TextSelection, selectionContext } = stateModule;
    const { createCellSelectionExtension } = cellSelectionModule;

    const editor = fixture(),
      context = selectionContext(schema, editor.state.nodes);

    const selection = new TextSelection({ id: 3, offset: 6 }, { id: 8, offset: 1 });

    const cells = createCellSelectionExtension({
      rows: () =>
        [
          [7, 9],
          [12, 14],
        ].map((row) => row.map((id) => ({ id, colspan: 1, rowspan: 1 }))),
    });

    return {
      text: selection.ranges(context),
      cells: new cells.CellSelection(5, 7, 12).ranges(context),
    };
  })();

  expect(result.text).toEqual([
    { kind: 'text', id: 3, from: 6, to: 13 },
    { kind: 'text', id: 4, from: 0, to: 6 },
    { kind: 'text', id: 8, from: 0, to: 1 },
  ]);
  expect(result.cells.map((range) => range.id).toSorted((a, b) => a - b)).toEqual([8, 13]);
});

test('serialized comment endpoints expand across interior insertion and follow split/move/join', async () => {
  const result = await (async () => {
    const { fixture, schema, dispatch } = editorFoundationModule;
    const { createAnchor, resolveAnchor } = stateModule;
    const editor = fixture();

    const start = JSON.parse(
      JSON.stringify(createAnchor(schema, editor.state, 'fixture', 3, 0, -1)),
    );

    const end = JSON.parse(JSON.stringify(createAnchor(schema, editor.state, 'fixture', 3, 5, 1)));
    dispatch(editor, [{ kind: 'replaceText', id: 3, from: 2, to: 2, text: 'new' }]);
    dispatch(editor, [{ kind: 'split', id: 3, at: 4, rightId: 18, rightKey: 'n-18' }]);

    const resolve = (anchor) =>
      resolveAnchor(schema, anchor, 'fixture', editor.state, editor.journal);

    const split = [resolve(start), resolve(end)];
    dispatch(editor, [
      { kind: 'moveChildren', parent: null, index: 0, count: 1, toParent: 16, toIndex: 0 },
    ]);
    const moved = [resolve(start), resolve(end)];
    dispatch(editor, [{ kind: 'join', left: 3, right: 18 }]);

    return { split, moved, joined: [resolve(start), resolve(end)] };
  })();

  for (const pair of [result.split, result.moved]) {
    expect(pair.map((r) => [r.status, r.anchor.blockKey, r.anchor.offset])).toEqual([
      ['resolved', 'n-3', 0],
      ['resolved', 'n-18', 4],
    ]);
  }

  expect(result.joined.map((r) => [r.status, r.anchor.blockKey, r.anchor.offset])).toEqual([
    ['resolved', 'n-3', 0],
    ['resolved', 'n-3', 8],
  ]);
});

test('both insertion associations and grapheme-safe atomic rejection', async () => {
  const result = await (async () => {
    const { fixture, schema, dispatch } = editorFoundationModule;
    const { createAnchor, resolveAnchor } = stateModule;
    const editor = fixture();

    const anchors = [-1, 1].map((bias) =>
      createAnchor(schema, editor.state, 'fixture', 3, 2, bias),
    );

    dispatch(editor, [{ kind: 'replaceText', id: 3, from: 2, to: 2, text: 'new' }]);

    const offsets = anchors.map(
      (a) => resolveAnchor(schema, a, 'fixture', editor.state, editor.journal).anchor.offset,
    );

    const before = editor.state;
    let rejected = false;

    try {
      dispatch(editor, [{ kind: 'replaceText', id: 3, from: 10, to: 10, text: '!' }]);
    } catch {
      rejected = true;
    }

    return { offsets, rejected, unchanged: editor.state === before };
  })();

  expect(result).toEqual({ offsets: [2, 5], rejected: true, unchanged: true });
});

test('stale agent coordinates reject atomically rather than overwriting another edit', async () => {
  const result = await (async () => {
    const { fixture, dispatch } = editorFoundationModule;

    const editor = fixture(),
      baseRevision = editor.state.revision;

    dispatch(editor, [{ kind: 'replaceText', id: 3, from: 0, to: 5, text: 'Human' }]);
    const before = editor.state;
    let error = '';

    try {
      editor.dispatch({
        baseRevision,
        origin: 'local',
        history: 'separate',
        time: 0,
        steps: [{ kind: 'replaceText', id: 3, from: 0, to: 5, text: 'Agent' }],
      });
    } catch (e) {
      error = e.message;
    }

    return { error, unchanged: editor.state === before };
  })();

  expect(result.error).toContain('Stale transaction');
  expect(result.unchanged).toBe(true);
});

test('snapshot positions resolve tree context, structural gaps and document order', async () => {
  const result = await (async () => {
    const { fixture, schema } = editorFoundationModule;
    const { createPositionSnapshot } = transformModule;
    const snapshot = createPositionSnapshot(schema, fixture().state);

    const heading = snapshot.text(3, 6),
      cell = snapshot.text(8, 1);

    const range = snapshot.range(cell, heading);

    return {
      ancestors: snapshot.resolve(heading).ancestors.map((n) => n.id),
      cellAncestors: snapshot.resolve(cell).ancestors.map((n) => n.id),
      shared: snapshot.commonAncestor(heading, snapshot.text(4, 0))?.id,
      rootShared: snapshot.commonAncestor(heading, cell),
      direction: [range.backward, range.from.id, range.to.id],
      order: [
        snapshot.compare(snapshot.before(1), heading),
        snapshot.compare(heading, cell),
        snapshot.compare(cell, snapshot.after(5)),
      ],
      empty: snapshot.resolve(snapshot.gap(16, 0)).ancestors.map((n) => n.id),
      adjacent: snapshot.compare(snapshot.after(1), snapshot.before(5)),
      atom: snapshot.compare(snapshot.before(17), snapshot.after(17)),
      rootStart: snapshot.resolve(snapshot.gap(null, 0)).ancestors,
      revision: snapshot.revision,
    };
  })();

  expect(result).toEqual({
    ancestors: [1, 2, 3],
    cellAncestors: [5, 6, 7, 8],
    shared: 2,
    rootShared: null,
    direction: [true, 3, 8],
    order: [-1, -1, -1],
    empty: [16],
    adjacent: 0,
    atom: -1,
    rootStart: [],
    revision: 0,
  });
});

test('snapshot positions reject foreign coordinates and invalid boundaries', async () => {
  const result = await (async () => {
    const { fixture, schema, dispatch } = editorFoundationModule;
    const { createPositionSnapshot } = transformModule;

    const editor = fixture(),
      original = createPositionSnapshot(schema, editor.state);

    const old = original.text(3, 6);
    dispatch(editor, [{ kind: 'replaceText', id: 3, from: 0, to: 0, text: 'new' }]);
    const next = createPositionSnapshot(schema, editor.state);

    const rejects = (action) => {
      try {
        action();

        return false;
      } catch {
        return true;
      }
    };

    return {
      failures: [
        () => original.text(3, 7), // Inside the emoji's UTF-16 surrogate pair.
        () => original.text(3, -1),
        () => original.text(3, 99),
        () => original.text(3, 1.5),
        () => original.text(17, 0),
        () => original.gap(3, 0),
        () => original.gap(16, 1),
        () => original.gap(null, -1),
        () => original.before(999),
        () => next.resolve(old),
        () => next.range(next.text(3, 0), old),
        () => original.resolve({ ...old }),
      ].map(rejects),
      originalStillValid: original.resolve(old).node.value,
      frozen: Object.isFrozen(old) && Object.isFrozen(original.resolve(old).ancestors),
    };
  })();

  expect(result.failures).toEqual(Array(12).fill(true));
  expect(result.originalStillValid).toBe('Alpha 😀 beta');
  expect(result.frozen).toBe(true);
});

test('comment range survives deletion of its original start while content remains', async () => {
  const result = await (async () => {
    const { fixture, dispatch, capture } = editorFoundationModule;

    const editor = fixture(),
      reference = capture(editor, 3, 1, 5);

    dispatch(editor, [{ kind: 'replaceText', id: 3, from: 0, to: 2, text: '' }]);

    return editor.positions.resolveRange(reference);
  })();

  expect(result).toEqual({ status: 'resolved', ranges: [{ id: 3, from: 0, to: 3 }] });
});

test('old external endpoints resolve after journal compaction and checkpoint reload', async () => {
  const result = await (async () => {
    const { fixture, schema, dispatch, capture } = editorFoundationModule;

    const { createEditor, textSelection, parseRelativeRange } = Object.assign(
      {},
      stateModule,
      modelModule,
    );

    const editor = fixture(),
      saved = JSON.stringify(capture(editor, 3, 1, 5));

    dispatch(editor, [{ kind: 'replaceText', id: 3, from: 0, to: 0, text: 'New ' }]);
    dispatch(editor, [{ kind: 'replaceText', id: 3, from: 6, to: 6, text: 'inside' }]);
    editor.compactJournal();
    const checkpoint = JSON.parse(JSON.stringify(editor.positions.checkpoint()));

    const reloaded = createEditor(
      schema,
      JSON.parse(JSON.stringify(editor.state.nodes)),
      textSelection(3, 0),
      [],
      {
        documentId: editor.documentId,
        revision: editor.state.revision,
        positionCheckpoint: checkpoint,
      },
    );

    return {
      journalLength: reloaded.journal.length,
      resolved: reloaded.positions.resolveRange(parseRelativeRange(JSON.parse(saved))),
    };
  })();

  expect(result).toEqual({
    journalLength: 0,
    resolved: { status: 'resolved', ranges: [{ id: 3, from: 5, to: 15 }] },
  });
});

test('transaction mapping connects nested text and structural gaps to the exact next snapshot', async () => {
  const result = await (async () => {
    const { fixture, schema, dispatch } = editorFoundationModule;
    const { createPositionSnapshot } = transformModule;

    const editor = fixture(),
      before = createPositionSnapshot(schema, editor.state);

    const text = before.text(3, 9),
      gap = before.gap(2, 1);

    const edit = dispatch(editor, [{ kind: 'split', id: 3, at: 6, rightId: 18, rightKey: 'n-18' }]);
    const after = createPositionSnapshot(schema, editor.state);
    const point = before.mapTo(after, text, edit.positionMapping);

    const left = before.mapTo(after, gap, edit.positionMapping, -1),
      right = before.mapTo(after, gap, edit.positionMapping, 1);

    let foreignRejected = false;
    const other = fixture();
    dispatch(other, []);

    try {
      before.mapTo(createPositionSnapshot(schema, other.state), text, edit.positionMapping);
    } catch {
      foreignRejected = true;
    }

    const unwrapStart = after.gap(2, 1);
    const unwrap = dispatch(editor, [{ kind: 'unwrap', id: 2 }]);
    const unwrapped = createPositionSnapshot(schema, editor.state);
    const lifted = after.mapTo(unwrapped, unwrapStart, unwrap.positionMapping);

    return { point, left, right, lifted, foreignRejected };
  })();

  // Compare the transport representation; snapshot positions carry private symbol brands.
  expect(structuredClone(result)).toEqual({
    point: { status: 'mapped', position: { kind: 'text', id: 18, offset: 3 } },
    left: { status: 'mapped', position: { kind: 'gap', parent: 2, index: 1 } },
    right: { status: 'mapped', position: { kind: 'gap', parent: 2, index: 2 } },
    lifted: { status: 'mapped', position: { kind: 'gap', parent: 1, index: 1 } },
    foreignRejected: true,
  });
});

test('durable references follow split/move/join, deletion and undo/redo', async () => {
  const result = await (async () => {
    const { fixture, dispatch, capture } = editorFoundationModule;

    const editor = fixture(),
      ref = capture(editor, 3, 1, 5);

    dispatch(editor, [{ kind: 'split', id: 3, at: 2, rightId: 18, rightKey: 'n-18' }]);
    const split = editor.positions.resolveRange(ref);
    dispatch(editor, [
      { kind: 'moveChildren', parent: null, index: 0, count: 1, toParent: 16, toIndex: 0 },
    ]);
    const moved = editor.positions.resolveRange(ref);
    dispatch(editor, [{ kind: 'join', left: 3, right: 18 }]);
    const joined = editor.positions.resolveRange(ref);
    dispatch(editor, [{ kind: 'replaceText', id: 3, from: 0, to: 5, text: '' }]);
    const deleted = editor.positions.resolveRange(ref);
    editor.compactJournal();
    editor.undo();
    const undo = editor.positions.resolveRange(ref);
    editor.redo();
    const redo = editor.positions.resolveRange(ref);

    return { split, moved, joined, deleted, undo, redo };
  })();

  const split = {
    status: 'resolved',
    ranges: [
      { id: 3, from: 1, to: 2 },
      { id: 18, from: 0, to: 3 },
    ],
  };

  const whole = { status: 'resolved', ranges: [{ id: 3, from: 1, to: 5 }] };
  expect(result).toEqual({
    split,
    moved: split,
    joined: whole,
    deleted: { status: 'deleted' },
    undo: whole,
    redo: { status: 'deleted' },
  });
});

test('reference edge associations, grouped history, and validation are explicit', async () => {
  const result = await (async () => {
    const { fixture, schema, dispatch, capture } = editorFoundationModule;

    const { createEditor, textSelection } = stateModule;
    const editor = fixture();
    const inside = capture(editor, 3, 1, 5);
    const inclusive = capture(editor, 3, 1, 5, 3, -1, 1);
    dispatch(editor, [{ kind: 'replaceText', id: 3, from: 1, to: 1, text: '!' }]);
    const edges = [inside, inclusive].map((r) => editor.positions.resolveRange(r));

    const grouped = fixture(),
      ref = capture(grouped, 3, 0, 5);

    for (let i = 0; i < 3; i++)
      grouped.dispatch({
        baseRevision: grouped.state.revision,
        origin: 'local',
        history: { group: 'typing' },
        time: i,
        steps: [{ kind: 'replaceText', id: 3, from: 2, to: 2, text: 'long' }],
      });
    const grown = grouped.positions.resolveRange(ref);
    grouped.undo();
    const undo = grouped.positions.resolveRange(ref);
    grouped.redo();
    const redo = grouped.positions.resolveRange(ref);
    const checkpoint = grouped.positions.checkpoint();
    let badCheckpoint = false;

    try {
      createEditor(schema, grouped.state.nodes, textSelection(3, 0), [], {
        documentId: grouped.documentId,
        revision: 999,
        positionCheckpoint: checkpoint,
      });
    } catch {
      badCheckpoint = true;
    }

    const foreign = editor.positions.resolveRange(ref);
    let badRange = false;

    try {
      capture(grouped, 3, 0, 999);
    } catch {
      badRange = true;
    }

    return { edges, grown, undo, redo, badCheckpoint, foreign, badRange };
  })();

  expect(result.edges).toEqual([
    { status: 'resolved', ranges: [{ id: 3, from: 2, to: 6 }] },
    { status: 'resolved', ranges: [{ id: 3, from: 1, to: 6 }] },
  ]);
  expect(result.grown).toEqual({ status: 'resolved', ranges: [{ id: 3, from: 0, to: 17 }] });
  expect(result.undo).toEqual({ status: 'resolved', ranges: [{ id: 3, from: 0, to: 5 }] });
  expect(result.redo).toEqual(result.grown);
  expect(result.badCheckpoint && result.badRange).toBe(true);
  expect(result.foreign).toEqual({ status: 'unavailable', reason: 'document-mismatch' });
});

test('wrapped gaps, text-only edits, removal and undo produce usable position mappings', async () => {
  const results = await (async () => {
    const { fixture, schema, dispatch } = editorFoundationModule;
    const { createPositionSnapshot } = transformModule;
    const editor = fixture();

    let source = createPositionSnapshot(schema, editor.state),
      point = source.gap(2, 1);

    const wrap = dispatch(editor, [
      {
        kind: 'wrapChildren',
        parent: 2,
        index: 0,
        count: 2,
        wrapper: { id: 18, key: 'n-18', kind: 'group', role: 'quote', children: [] },
      },
    ]);

    let target = createPositionSnapshot(schema, editor.state);
    const wrapped = source.mapTo(target, point, wrap.positionMapping);
    source = target;
    point = wrapped.position;
    const undo = editor.undo();
    target = createPositionSnapshot(schema, editor.state);
    const restored = source.mapTo(target, point, undo.positionMapping);
    source = target;
    point = target.before(3);
    const edit = dispatch(editor, [{ kind: 'replaceText', id: 3, from: 0, to: 1, text: 'X' }]);
    target = createPositionSnapshot(schema, editor.state);
    const unchanged = source.mapTo(target, point, edit.positionMapping);
    source = target;
    point = source.text(3, 2);
    const remove = dispatch(editor, [{ kind: 'removeChildren', parent: 2, index: 0, count: 1 }]);
    target = createPositionSnapshot(schema, editor.state);

    return {
      wrapped,
      restored,
      unchanged,
      removed: source.mapTo(target, point, remove.positionMapping),
    };
  })();

  expect(structuredClone(results)).toEqual({
    wrapped: { status: 'mapped', position: { kind: 'gap', parent: 18, index: 1 } },
    restored: { status: 'mapped', position: { kind: 'gap', parent: 2, index: 1 } },
    unchanged: { status: 'mapped', position: { kind: 'gap', parent: 2, index: 0 } },
    removed: { status: 'deleted' },
  });
});

test('disjoint ranges preserve surviving cells and references created after an edit survive undo/redo', async () => {
  const result = await (async () => {
    const { fixture, dispatch, capture } = editorFoundationModule;

    const editor = fixture(),
      cells = [capture(editor, 8, 0, 1), capture(editor, 13, 0, 1)];

    dispatch(editor, [{ kind: 'removeChildren', parent: 6, index: 0, count: 1 }]);

    const resolveCells = () => ({
      status: 'resolved',
      ranges: cells.flatMap((r) => {
        const resultValue = editor.positions.resolveRange(r);

        return resultValue.status === 'resolved' ? resultValue.ranges : [];
      }),
    });

    const surviving = resolveCells();
    editor.undo();
    const restored = resolveCells();
    dispatch(editor, [{ kind: 'replaceText', id: 3, from: 2, to: 2, text: 'new' }]);
    const later = capture(editor, 3, 2, 5);
    editor.undo();
    const removed = editor.positions.resolveRange(later);
    editor.redo();
    const returned = editor.positions.resolveRange(later);
    const before = editor.positions.checkpoint();

    try {
      dispatch(editor, [
        { kind: 'replaceText', id: 3, from: 0, to: 1, text: 'bad' },
        { kind: 'removeChildren', parent: 999, index: 0, count: 1 },
      ]);
    } catch {}

    return {
      surviving,
      restored,
      removed,
      returned,
      atomic: JSON.stringify(before) === JSON.stringify(editor.positions.checkpoint()),
    };
  })();

  expect(result).toEqual({
    surviving: { status: 'resolved', ranges: [{ id: 13, from: 0, to: 1 }] },
    restored: {
      status: 'resolved',
      ranges: [
        { id: 8, from: 0, to: 1 },
        { id: 13, from: 0, to: 1 },
      ],
    },
    removed: { status: 'deleted' },
    returned: { status: 'resolved', ranges: [{ id: 3, from: 2, to: 5 }] },
    atomic: true,
  });
});

test('external endpoints require no registration and survive endpoint-block deletion', async () => {
  const result = await (async () => {
    const { fixture, dispatch, capture } = editorFoundationModule;
    const { parseRelativeRange } = modelModule;

    const editor = fixture(),
      checkpoint = JSON.stringify(editor.positions.checkpoint());

    for (let i = 0; i < 10000; i++) capture(editor, 3, 0, 5);
    const unchanged = checkpoint === JSON.stringify(editor.positions.checkpoint());

    const range = parseRelativeRange({
      version: 1,
      start: {
        version: 1,
        documentId: editor.documentId,
        revision: 0,
        key: 'n-3',
        offset: 2,
        association: 1,
      },
      end: {
        version: 1,
        documentId: editor.documentId,
        revision: 0,
        key: 'n-10',
        offset: 1,
        association: -1,
      },
    });

    dispatch(editor, [
      { kind: 'removeChildren', parent: 2, index: 0, count: 1 },
      { kind: 'removeChildren', parent: 6, index: 1, count: 1 },
    ]);
    const surviving = editor.positions.resolveRange(range);
    editor.undo();
    const restored = editor.positions.resolveRange(range);

    return { unchanged, surviving, restored };
  })();

  expect(result.unchanged).toBe(true);
  expect(result.surviving).toEqual({
    status: 'resolved',
    ranges: [
      { id: 4, from: 0, to: 6 },
      { id: 8, from: 0, to: 1 },
    ],
  });
  expect(result.restored.ranges.map((r) => r.id)).toEqual([3, 4, 8, 10]);
});

test('new text blocks inside a range are included and checkpoint state does not alias results', async () => {
  const result = await (async () => {
    const { fixture, dispatch, capture } = editorFoundationModule;

    const editor = fixture(),
      range = capture(editor, 3, 0, 6, 4);

    dispatch(editor, [
      {
        kind: 'insertChildren',
        parent: 2,
        index: 1,
        nodes: [{ id: 18, key: 'n-18', kind: 'text', role: 'body', value: 'Inserted' }],
      },
    ]);
    dispatch(editor, [{ kind: 'replaceText', id: 18, from: 3, to: 3, text: '!' }]);
    const checkpoint = editor.positions.checkpoint();
    checkpoint.definitions.at(-1).maps[0].inserted = 999;

    return editor.positions.resolveRange(range);
  })();

  expect(result).toEqual({
    status: 'resolved',
    ranges: [
      { id: 3, from: 0, to: 13 },
      { id: 18, from: 0, to: 9 },
      { id: 4, from: 0, to: 6 },
    ],
  });
});

test('read-only and protected nodes can move or be deleted, but reject content edits atomically', async () => {
  const result = await (async () => {
    const { fixture, dispatch } = editorFoundationModule;

    const permissions = {
      access: (n) => (n.id === 3 ? 'read-only' : n.id === 8 ? 'protected' : 'editable'),
    };

    const editor = fixture({ permissions }),
      before = editor.state;

    const checkpoint = JSON.stringify(editor.positions.checkpoint());

    const rejects = (action) => {
      try {
        action();

        return false;
      } catch (e) {
        return e.name === 'PermissionDenied';
      }
    };

    const denied = rejects(() =>
      dispatch(editor, [
        { kind: 'replaceText', id: 4, from: 0, to: 0, text: '!' },
        { kind: 'replaceText', id: 3, from: 0, to: 0, text: '!' },
      ]),
    );

    const atomic =
      editor.state === before &&
      checkpoint === JSON.stringify(editor.positions.checkpoint()) &&
      editor.history.undo === 0;

    dispatch(editor, [
      { kind: 'moveChildren', parent: 2, index: 0, count: 1, toParent: 16, toIndex: 0 },
    ]);
    dispatch(editor, [
      { kind: 'removeChildren', parent: 16, index: 0, count: 1 },
      { kind: 'removeChildren', parent: 7, index: 0, count: 1 },
    ]);
    editor.undo();
    editor.undo();

    return {
      denied,
      atomic,
      restored: JSON.stringify(before.nodes) === JSON.stringify(editor.state.nodes),
    };
  })();

  expect(result).toEqual({ denied: true, atomic: true, restored: true });
});

test('general locks protect descendant deletion and history uses current permissions', async () => {
  const result = await (async () => {
    const { fixture, schema, dispatch } = editorFoundationModule;
    const { indexTree } = modelModule;
    let edit = true;

    const editor = fixture({
      permissions: { access: (n) => (n.id === 3 && !edit ? 'read-only' : 'editable') },
    });

    const node = indexTree(schema, editor.state.nodes).byId.get(3).node;
    dispatch(editor, [{ kind: 'updateBlock', node: { ...node, locked: true } }]);
    edit = false;

    const rejects = (action) => {
      try {
        action();

        return false;
      } catch (e) {
        return e.name === 'PermissionDenied';
      }
    };

    const denied = [
      () => dispatch(editor, [{ kind: 'removeChildren', parent: null, index: 0, count: 1 }]),
      () => dispatch(editor, [{ kind: 'removeChildren', parent: 2, index: 0, count: 1 }]),
      () => editor.undo(),
      () => dispatch(editor, [{ kind: 'updateBlock', node }]),
    ].map(rejects);

    dispatch(editor, [
      { kind: 'moveChildren', parent: 2, index: 0, count: 1, toParent: 16, toIndex: 0 },
    ]);
    edit = true;
    dispatch(editor, [{ kind: 'removeChildren', parent: 16, index: 0, count: 1 }]);

    return { denied, deleted: !indexTree(schema, editor.state.nodes).byId.has(3) };
  })();

  expect(result).toEqual({ denied: [true, true, true, true], deleted: true });
});

test('permission projections omit protected subtrees in initial and subsequent snapshots', async () => {
  const result = await (async () => {
    const { fixture, schema, dispatch } = editorFoundationModule;
    const { projectDocument } = stateModule;

    const editor = fixture(),
      permissions = {
        access: (n) => (n.id === 1 ? 'protected' : n.id === 5 ? 'read-only' : 'editable'),
      };

    const first = projectDocument(schema, editor.state.nodes, permissions);
    dispatch(editor, [{ kind: 'replaceText', id: 3, from: 0, to: 13, text: 'SECRET-CHANGED' }]);
    const next = projectDocument(schema, editor.state.nodes, permissions);

    return {
      same: JSON.stringify(first) === JSON.stringify(next),
      placeholder: next[0],
      leaked: /Alpha|Second|SECRET|n-3|n-4/.test(JSON.stringify(next)),
      containerChildren: next[1].node.children,
      inherited: next[1].children[0].children[0].children[0].access,
    };
  })();

  expect(result).toEqual({
    same: true,
    placeholder: { kind: 'protected', key: 'n-1', locked: false },
    leaked: false,
    containerChildren: [],
    inherited: 'read-only',
  });
});

test('agent proposals follow unrelated edits, reject changed targets and commit against the checked revision', async () => {
  const result = await (async () => {
    const { fixture, schema, dispatch, capture } = editorFoundationModule;

    const { prepareTextProposal, indexTree } = Object.assign({}, stateModule, modelModule);

    const editor = fixture(),
      proposal = {
        range: capture(editor, 3, 0, 5),
        expected: [{ key: 'n-3', text: 'Alpha' }],
        replacement: 'Agent',
      };

    dispatch(editor, [
      { kind: 'replaceText', id: 4, from: 0, to: 0, text: 'Unrelated' },
      { kind: 'replaceText', id: 3, from: 0, to: 0, text: 'Before ' },
    ]);
    const ready = prepareTextProposal(schema, editor, proposal);
    editor.dispatch({ ...ready, origin: 'local', history: 'separate', time: 0 });
    const text = schema.text(indexTree(schema, editor.state.nodes).byId.get(3).node);
    const conflict = prepareTextProposal(schema, editor, proposal);
    editor.undo();
    const stale = prepareTextProposal(schema, editor, proposal);
    dispatch(editor, [{ kind: 'replaceText', id: 4, from: 0, to: 0, text: '!' }]);
    let rejected = false;

    try {
      editor.dispatch({ ...stale, origin: 'local', history: 'separate', time: 0 });
    } catch {
      rejected = true;
    }

    return { ready: ready.status, text, conflict: conflict.status, rejected };
  })();

  expect(result).toEqual({
    ready: 'ready',
    text: 'Before Agent 😀 beta',
    conflict: 'conflict',
    rejected: true,
  });
});

test('headless command chains share draft state, commit once, and capability checks have no effects', async () => {
  const result = await (async () => {
    const { fixture, schema } = editorFoundationModule;

    const { indexTree, textSelection } = Object.assign({}, modelModule, stateModule);

    const editor = fixture(),
      initial = editor.state,
      checkpoint = JSON.stringify(editor.positions.checkpoint());

    let calls = 0;
    const unsubscribe = editor.subscribe(() => calls++);

    const append = (context, text) => {
      const node = indexTree(schema, context.state.nodes).byId.get(4).node;
      context.step({
        kind: 'replaceText',
        id: 4,
        from: node.value.length,
        to: node.value.length,
        text,
      });

      return true;
    };

    const can = editor.can().command(append, '!').command(append, '?').run();

    const dry =
      editor.state === initial &&
      editor.history.undo === 0 &&
      calls === 0 &&
      checkpoint === JSON.stringify(editor.positions.checkpoint());

    const ran = editor
      .chain()
      .command(append, '!')
      .command(append, '?')
      .select(textSelection(4, 8))
      .run();

    const after = {
      value: schema.text(indexTree(schema, editor.state.nodes).byId.get(4).node),
      revision: editor.state.revision,
      history: editor.history.undo,
      calls,
    };

    const abandoned = editor
      .chain()
      .command(append, 'bad')
      .command(() => false)
      .run();

    editor.undo();
    unsubscribe();
    editor.redo();
    const stale = editor.chain().command(append, 'stale');
    editor.select(textSelection(3, 0));

    return { can, dry, ran, after, abandoned, calls, stale: stale.run() };
  })();

  expect(result).toEqual({
    can: true,
    dry: true,
    ran: true,
    after: { value: 'Second!?', revision: 1, history: 1, calls: 1 },
    abandoned: false,
    calls: 2,
    stale: false,
  });
});

test('command capability checks respect current permissions without mutating state', async () => {
  const result = await (async () => {
    const { fixture } = editorFoundationModule;

    const editor = fixture({
        permissions: { access: (n) => (n.id === 3 ? 'read-only' : 'editable') },
      }),
      state = editor.state;

    const can = editor.can().step({ kind: 'replaceText', id: 3, from: 0, to: 0, text: '!' }).run();

    const run = editor
      .chain()
      .step({ kind: 'replaceText', id: 4, from: 0, to: 0, text: '!' })
      .step({ kind: 'replaceText', id: 3, from: 0, to: 0, text: '!' })
      .run();

    return { can, run, unchanged: editor.state === state, history: editor.history.undo };
  })();

  expect(result).toEqual({ can: false, run: false, unchanged: true, history: 0 });
});

test('external comment threads produce decorations without changing schema or range storage', async () => {
  const result = await (async () => {
    const { fixture, dispatch, capture } = editorFoundationModule;
    const { resolveRangeDecorations } = stateModule;
    const { commentDecorations } = commentModule;
    const editor = fixture();

    const threads = [
      { id: 'discussion', range: capture(editor, 3, 1, 5), messages: ['Keep this wording'] },
    ];

    const stored = JSON.stringify(threads);
    dispatch(editor, [{ kind: 'replaceText', id: 3, from: 2, to: 2, text: 'new' }]);

    const current = resolveRangeDecorations(
      commentDecorations(JSON.parse(stored)),
      editor.positions,
    );

    dispatch(editor, [{ kind: 'replaceText', id: 3, from: 0, to: 8, text: '' }]);
    const orphaned = resolveRangeDecorations(commentDecorations(threads), editor.positions);
    editor.undo();
    const restored = resolveRangeDecorations(commentDecorations(threads), editor.positions);

    return {
      range: current.resolved[0].ranges,
      orphaned: orphaned.unresolved,
      restored: restored.resolved[0].ranges,
      unchanged: JSON.stringify(threads) === stored,
      noSchemaField: !JSON.stringify(editor.state.nodes).includes('discussion'),
    };
  })();

  expect(result).toEqual({
    range: [{ kind: 'text', id: 3, from: 1, to: 8 }],
    orphaned: [{ id: 'discussion', result: { status: 'deleted' } }],
    restored: [{ kind: 'text', id: 3, from: 1, to: 8 }],
    unchanged: true,
    noSchemaField: true,
  });
});

test('revoking edit permission after chain preparation prevents execution and capability success', async () => {
  const result = await (async () => {
    const { fixture } = editorFoundationModule;
    let editable = true;

    const editor = fixture({
        permissions: { access: () => (editable ? 'editable' : 'read-only') },
      }),
      initial = editor.state;

    const step = { kind: 'replaceText', id: 3, from: 0, to: 0, text: '!' };

    const prepared = editor.chain().step(step),
      check = editor.can().step(step);

    editable = false;

    return { run: prepared.run(), can: check.run(), unchanged: editor.state === initial };
  })();

  expect(result).toEqual({ run: false, can: false, unchanged: true });
});

test('node locks survive starter-kit heading conversion and end-of-heading splits', async () => {
  const result = await (async () => {
    const { createEditor, textSelection } = stateModule;
    const { demoSchema } = demoSchemaModule;
    const { setTextBlockType } = headingsModule;

    const editor = createEditor(
      demoSchema,
      [{ kind: 'paragraph', id: 1, key: 'p', text: 'Locked', locked: true, marks: [], inline: [] }],
      textSelection(1, 0),
    );

    const dispatch = (steps) =>
      editor.dispatch({
        baseRevision: editor.state.revision,
        origin: 'local',
        history: 'separate',
        time: 0,
        steps,
      });

    dispatch(setTextBlockType(demoSchema, editor.state, [1], 2));
    const heading = editor.state.nodes[0];
    dispatch([{ kind: 'split', id: 1, at: 6, rightId: 2, rightKey: 'p2' }]);

    return {
      heading: [heading.kind, heading.locked],
      tail: [editor.state.nodes[1].kind, editor.state.nodes[1].locked],
    };
  })();

  expect(result).toEqual({ heading: ['heading', true], tail: ['paragraph', true] });
});

test('permission inheritance protects nested content and opaque property changes', async () => {
  const result = await (async () => {
    const { fixture, schema: serializableSchema, dispatch } = editorFoundationModule;

    const { indexTree } = modelModule;
    const { createEditor } = stateModule;
    // Exercise the lower-level permission guard with deliberately opaque data.
    // Public extension attributes are JSON; this adapter isolates the state contract.
    const schema = { ...serializableSchema, validateUpdate() {} };
    let readonly = false;

    const initial = fixture();

    const editor = createEditor(schema, initial.state.nodes, initial.state.selection, [], {
      permissions: { access: (n) => (n.id === 1 && readonly ? 'read-only' : 'editable') },
    });

    const node = indexTree(schema, editor.state.nodes).byId.get(3).node;
    dispatch(editor, [{ kind: 'updateBlock', node: { ...node, updatedAt: new Date(0) } }]);
    readonly = true;

    const rejects = (action) => {
      try {
        action();

        return false;
      } catch (e) {
        return e.name === 'PermissionDenied';
      }
    };

    return [
      () => dispatch(editor, [{ kind: 'replaceText', id: 3, from: 0, to: 0, text: '!' }]),
      () => dispatch(editor, [{ kind: 'updateBlock', node: { ...node, updatedAt: new Date(1) } }]),
      () => dispatch(editor, [{ kind: 'removeChildren', parent: 2, index: 0, count: 1 }]),
    ].map(rejects);
  })();

  expect(result).toEqual([true, true, true]);
});

test('position checkpoint rejects missing original operations and invalid undo sequences', async () => {
  const result = await (async () => {
    const { fixture, schema, dispatch, capture } = editorFoundationModule;

    const { createEditor, textSelection } = stateModule;

    const editor = fixture(),
      range = capture(editor, 3, 0, 5);

    dispatch(editor, [{ kind: 'replaceText', id: 3, from: 2, to: 2, text: '!' }]);
    editor.undo();
    editor.redo();
    const checkpoint = editor.positions.checkpoint();

    const load = (positions) =>
      createEditor(schema, editor.state.nodes, textSelection(3, 0), [], {
        documentId: editor.documentId,
        revision: editor.state.revision,
        positionCheckpoint: positions,
      });

    const restored = load(checkpoint).positions.resolveRange(range);

    const rejects = (mutate) => {
      const copy = structuredClone(checkpoint);
      mutate(copy);

      try {
        load(copy);

        return false;
      } catch {
        return true;
      }
    };

    return {
      restored,
      rejected: [
        (c) => {
          c.events = [];
        },
        (c) => {
          c.events[0].operations[0].inverse = true;
        },
        (c) => {
          c.events[1].operations[0].inverse = false;
        },
      ].map(rejects),
    };
  })();

  expect(result).toEqual({
    restored: { status: 'resolved', ranges: [{ id: 3, from: 0, to: 6 }] },
    rejected: [true, true, true],
  });
});

test('joins and range replacements cannot copy protected source text into visible nodes', async () => {
  const result = await (async () => {
    const { fixture, schema, dispatch } = editorFoundationModule;
    const { projectDocument } = stateModule;
    const permissions = { access: (n) => (n.id === 4 ? 'protected' : 'editable') };

    const editor = fixture({ permissions }),
      initial = editor.state;

    const rejects = (action) => {
      try {
        action();

        return false;
      } catch (e) {
        return e.name === 'PermissionDenied';
      }
    };

    const rejected = [
      () => dispatch(editor, [{ kind: 'join', left: 3, right: 4 }]),
      () =>
        dispatch(editor, [
          {
            kind: 'replaceRanges',
            ranges: [
              { kind: 'text', id: 3, from: 9, to: 13 },
              { kind: 'text', id: 4, from: 0, to: 1 },
            ],
            text: '',
            pruneEmpty: [],
          },
        ]),
    ].map(rejects);

    return {
      rejected,
      atomic: editor.state === initial,
      leaked: JSON.stringify(projectDocument(schema, editor.state.nodes, permissions)).includes(
        'Second',
      ),
    };
  })();

  expect(result).toEqual({ rejected: [true, true], atomic: true, leaked: false });
});

test('undo cannot merge a newly protected split into an editable node', async () => {
  const result = await (async () => {
    const { fixture, dispatch } = editorFoundationModule;
    let restricted = false;

    const editor = fixture({
      permissions: { access: (n) => (restricted && n.id === 18 ? 'protected' : 'editable') },
    });

    dispatch(editor, [{ kind: 'split', id: 3, at: 6, rightId: 18, rightKey: 'secret' }]);
    restricted = true;
    const initial = editor.state;
    let rejected = false;

    try {
      editor.undo();
    } catch (e) {
      rejected = e.name === 'PermissionDenied';
    }

    return { rejected, atomic: editor.state === initial };
  })();

  expect(result).toEqual({ rejected: true, atomic: true });
});

test('indexed mapping agrees with exact replay across varied histories and capture revisions', async () => {
  const result = await (async () => {
    const { fixture, schema, dispatch, capture } = editorFoundationModule;

    const { replayRange } = replayPositionsModule;

    const { indexTree, boundaries, createEditor, textSelection } = Object.assign(
      {},
      modelModule,
      stateModule,
    );

    let seed = 1234567,
      checked = 0,
      editor = fixture();

    const ranges = [];

    const random = (n) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

      return seed % n;
    };

    function captureMore() {
      const nodes = indexTree(schema, editor.state.nodes)
        .order.map((e) => e.node)
        .filter((n) => schema.text(n) !== null);

      for (let i = 0; i < 5; i++) {
        const a = random(nodes.length),
          b = a + random(nodes.length - a),
          stopsA = boundaries(schema.text(nodes[a])),
          stopsB = boundaries(schema.text(nodes[b]));

        const from = stopsA[random(stopsA.length)],
          to = b === a ? from + 0 : stopsB[random(stopsB.length)];

        const end =
          b === a
            ? stopsA.filter((at) => at >= from)[random(stopsA.filter((at) => at >= from).length)]
            : to;

        ranges.push(
          capture(
            editor,
            nodes[a].id,
            from,
            end,
            nodes[b].id,
            random(2) ? 1 : -1,
            random(2) ? 1 : -1,
          ),
        );
      }
    }

    captureMore();

    for (let i = 0; i < 260; i++) {
      const tree = indexTree(schema, editor.state.nodes),
        texts = tree.order.filter((e) => schema.text(e.node) !== null),
        entry = texts[random(texts.length)];

      const text = schema.text(entry.node),
        stops = boundaries(text),
        fromIndex = random(stops.length),
        toIndex = fromIndex + random(stops.length - fromIndex);

      if (i % 37 === 0) {
        const id = 1000 + i;
        dispatch(editor, [
          {
            kind: 'split',
            id: entry.node.id,
            at: stops[fromIndex],
            rightId: id,
            rightKey: `random-${id}`,
          },
        ]);
      } else {
        dispatch(editor, [
          {
            kind: 'replaceText',
            id: entry.node.id,
            from: stops[fromIndex],
            to: stops[toIndex],
            text: ['', 'x', '😀', 'longer', 'e\u0301'][random(5)],
          },
        ]);
      }

      if (i % 19 === 0) {
        editor.undo();
        editor.redo();
      }

      if (i % 23 === 0) captureMore();

      if (i % 13 === 0 || i === 259)
        for (const range of ranges) {
          const actual = editor.positions.resolveRange(range),
            expected = replayRange(schema, editor, range);

          if (JSON.stringify(actual) !== JSON.stringify(expected))
            throw new Error(JSON.stringify({ i, range, actual, expected }));
          checked++;
        }

      if (i === 130) {
        const state = editor.state,
          checkpoint = editor.positions.checkpoint();

        editor = createEditor(schema, state.nodes, textSelection(texts[0].node.id, 0), [], {
          documentId: editor.documentId,
          revision: state.revision,
          positionCheckpoint: checkpoint,
        });
      }
    }

    return checked;
  })();

  expect(result).toBeGreaterThan(500);
});

test('mapping shortcuts retain boundary deletion and mixed-delta semantics', async () => {
  const results = await (async () => {
    const { fixture, schema, dispatch, capture } = editorFoundationModule;

    const { replayRange } = replayPositionsModule;
    const cases = [];

    for (const startBias of [-1, 1])
      for (const endBias of [-1, 1]) {
        const editor = fixture(),
          range = capture(editor, 4, 0, 6, 4, startBias, endBias);

        dispatch(editor, [{ kind: 'replaceText', id: 4, from: 0, to: 6, text: 'Second' }]);
        cases.push([editor.positions.resolveRange(range), { status: 'deleted' }]);
      }

    const editor = fixture(),
      ranges = [];

    dispatch(editor, [{ kind: 'replaceText', id: 4, from: 0, to: 6, text: 'x'.repeat(256) }]);

    for (let i = 0; i < 256; i++)
      for (const bias of [-1, 1]) ranges.push(capture(editor, 4, i, i + 1, 4, bias, -bias));
    let seed = 22;

    for (let i = 0; i < 200; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

      const from = seed % 20,
        length = i % 2 ? 0 : 2;

      dispatch(editor, [
        { kind: 'replaceText', id: 4, from, to: from + length, text: i % 2 ? 'abc' : '' },
      ]);
    }

    for (const range of ranges) {
      const expected = replayRange(schema, editor, range);
      cases.push([editor.positions.resolveRange(range), expected]);
      const mixed = editor.positions.resolveDocumentRange(range);
      cases.push([
        mixed.status === 'resolved'
          ? { ...mixed, ranges: mixed.ranges.map(({ kind: _kind, ...rangeValue }) => rangeValue) }
          : mixed,
        expected,
      ]);
    }

    return cases;
  })();

  for (const [actual, expected] of results) expect(actual).toEqual(expected);
});

test('batched command steps publish once and undo together', async () => {
  const result = await (async () => {
    const { fixture } = editorFoundationModule;

    const editor = fixture(),
      initial = editor.state.nodes;

    let calls = 0;
    editor.subscribe(() => calls++);

    const steps = [
      { kind: 'replaceText', id: 4, from: 0, to: 0, text: 'A' },
      { kind: 'replaceText', id: 4, from: 1, to: 1, text: 'B' },
    ];

    const can = editor.can().steps(steps).run(),
      unchanged = editor.state.nodes === initial && calls === 0;

    const ran = editor.chain().steps(steps).run(),
      committed = calls === 1 && editor.history.undo === 1;

    editor.undo();

    return {
      can,
      unchanged,
      ran,
      committed,
      restored: JSON.stringify(editor.state.nodes) === JSON.stringify(initial),
    };
  })();

  expect(result).toEqual({
    can: true,
    unchanged: true,
    ran: true,
    committed: true,
    restored: true,
  });
});

// Acceptance case awaiting concurrency support; no fake policy evaluator.
// oxlint-disable-next-line vitest/warn-todo -- Preserve the explicit, pre-existing unimplemented concurrency contract.
test.todo('concurrent split and insert converge with the insert following moved text');
