import { formattingMarks } from '@gprose/extension-document';
import { createMention } from '@gprose/extension-document';
import { parseAnchor, boundaries } from '@gprose/model';
import {
  textSelection,
  selectionContext,
  createEditor,
  applyTransaction,
  type Transaction,
  createAnchor,
  resolveAnchor,
} from '@gprose/state';
import { mapPosition } from '@gprose/transform';

import type { TextBlockNode, StarterNode } from './demo-model.js';
import { demoSchema } from './demo-schema.js';
import { createSampleDocument } from './sample-document.js';

export function checkTransactions() {
  let assertions = 0;

  function check(value: boolean, message: string) {
    assertions++;

    if (!value) throw new Error(message);
  }

  function equal<Value>(a: Value, b: Value, message: string) {
    check(JSON.stringify(a) === JSON.stringify(b), message);
  }

  const paragraph: TextBlockNode = {
    kind: 'paragraph',
    id: 1,
    key: 'original',
    text: 'café office \ufffc tail',
    marks: formattingMarks([{ start: 5, end: 11, bold: true, italic: false }]),
    inline: [
      createMention({ id: 'mention', index: 12, label: 'Maya', width: 70, ascent: 20, descent: 5 }),
    ],
  };

  for (const at of boundaries(paragraph.text)) {
    const editor = createEditor(demoSchema, [paragraph], textSelection(1, at, at));

    const beforeAnchor = createAnchor(demoSchema, editor.state, 'doc', 1, at, -1),
      afterAnchor = createAnchor(demoSchema, editor.state, 'doc', 1, at, 1);

    const tx: Transaction<StarterNode> = {
      baseRevision: 0,
      origin: 'local',
      history: 'separate',
      time: 0,
      steps: [{ kind: 'split', id: 1, at, rightId: 2, rightKey: 'right' }],
      selection: textSelection(2, 0, 0),
    };

    const result = editor.dispatch(tx);

    // Forward commands are deterministic over independent document copies.
    const replay = applyTransaction(
      demoSchema,
      { nodes: structuredClone([paragraph]), selection: textSelection(1, at, at), revision: 0 },
      {
        ...structuredClone(tx),
        selection: editor.readSelection(
          textSelection(2, 0).encode(selectionContext(demoSchema, result.state.nodes)),
        ),
      },
    );

    equal(result.state, replay.state, 'Deterministic split replay');

    const left = resolveAnchor(
      demoSchema,
      parseAnchor(JSON.parse(JSON.stringify(beforeAnchor))),
      'doc',
      editor.state,
      editor.journal,
    );

    const right = resolveAnchor(demoSchema, afterAnchor, 'doc', editor.state, editor.journal);
    check(
      left.status === 'resolved' &&
        left.anchor.blockKey === 'original' &&
        left.anchor.offset === at,
      'Split left affinity',
    );
    check(
      right.status === 'resolved' && right.anchor.blockKey === 'right' && right.anchor.offset === 0,
      'Split right affinity',
    );
    editor.dispatch({
      baseRevision: 1,
      origin: 'local',
      history: 'separate',
      time: 1,
      steps: [{ kind: 'join', left: 1, right: 2 }],
    });
    equal(editor.state.nodes, [paragraph], 'Split/join preserves rich content');
    editor.undo();
    equal(editor.state.nodes, result.state.nodes, 'Undo join');
    editor.undo();
    equal(editor.state.nodes, [paragraph], 'Undo split');
    editor.redo();
    editor.redo();
    equal(editor.state.nodes, [paragraph], 'Redo split and join');
    const resolved = resolveAnchor(demoSchema, afterAnchor, 'doc', editor.state, editor.journal);
    check(
      resolved.status === 'resolved' &&
        resolved.anchor.blockKey === 'original' &&
        resolved.anchor.offset === at,
      'Anchor follows undo/redo structural maps',
    );
  }

  const editor = createEditor(demoSchema, createSampleDocument(), textSelection(1, 0, 0));

  const initial = editor.state.nodes[0],
    anchors = [-1, 1] as const;

  const saved = anchors.map((bias) => createAnchor(demoSchema, editor.state, 'doc', 1, 0, bias));

  for (let i = 0; i < 3; i++)
    editor.dispatch({
      baseRevision: editor.state.revision,
      origin: 'local',
      history: { group: 'typing:1' },
      time: i * 100,
      steps: [{ kind: 'replaceText', id: 1, from: i, to: i, text: 'x' }],
    });
  check(editor.history.undo === 1, 'Adjacent typing groups');
  const stream: StarterNode = { kind: 'image', id: 900, key: 'streamed', src: 'test', alt: 'test' };
  editor.dispatch({
    baseRevision: editor.state.revision,
    origin: 'stream',
    history: 'exclude',
    steps: [{ kind: 'append', nodes: [stream] }],
  });

  const persisted = JSON.parse(
    JSON.stringify({ state: editor.state, journal: editor.journal, anchors: saved }),
  );

  for (let i = 0; i < 2; i++) {
    const resolved = resolveAnchor(
      demoSchema,
      parseAnchor(persisted.anchors[i]),
      'doc',
      persisted.state,
      persisted.journal,
    );

    check(
      resolved.status === 'resolved' && resolved.anchor.offset === (i === 0 ? 0 : 3),
      'Persisted insertion affinity',
    );
  }

  editor.undo();
  equal(editor.state.nodes[0], initial, 'Grouped undo');
  check(editor.state.nodes.at(-1) === stream, 'Undo preserves streamed block');
  editor.redo();
  editor.select(textSelection(1, 0));
  editor.dispatch({
    baseRevision: editor.state.revision,
    origin: 'local',
    history: { group: 'typing:1' },
    time: 350,
    steps: [{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'y' }],
  });
  check(editor.history.undo === 2, 'Selection movement breaks typing groups');
  const before = editor.state;

  for (const tx of [
    { baseRevision: 0, origin: 'local', history: 'separate', time: 400, steps: [] },
    {
      baseRevision: before.revision,
      origin: 'local',
      history: 'separate',
      time: 400,
      steps: [
        { kind: 'replaceText', id: 1, from: 0, to: 0, text: 'valid' },
        { kind: 'split', id: 1, at: 1, rightId: 2, rightKey: 'collision' },
      ],
    },
  ] satisfies Transaction<StarterNode>[]) {
    let rejected = false;

    try {
      editor.dispatch(tx);
    } catch {
      rejected = true;
    }

    check(rejected && editor.state === before, 'Failed transaction is atomic');
  }

  const target = createAnchor(demoSchema, editor.state, 'doc', 1, 1, 1);
  editor.dispatch({
    baseRevision: editor.state.revision,
    origin: 'local',
    history: 'separate',
    time: 500,
    steps: [{ kind: 'replaceText', id: 1, from: 0, to: 3, text: '' }],
  });
  check(
    resolveAnchor(demoSchema, target, 'doc', editor.state, editor.journal).status === 'deleted',
    'Deleted reference is explicit',
  );
  const missing = resolveAnchor(demoSchema, saved[0], 'doc', editor.state, []);
  check(
    missing.status === 'unavailable' && missing.reason === 'history-unavailable',
    'Missing history is not guessed',
  );
  check(
    resolveAnchor(demoSchema, target, 'other', editor.state, editor.journal).status ===
      'unavailable',
    'Cross-document reference rejected',
  );

  for (const value of [
    null,
    {},
    { ...target, offset: -1 },
    { ...target, revision: Infinity },
    { ...target, bias: 0 },
  ]) {
    let rejected = false;

    try {
      parseAnchor(value);
    } catch {
      rejected = true;
    }

    check(rejected, 'Malformed persisted anchor rejected');
  }

  equal(
    mapPosition(1, 4, 1, { kind: 'replace', id: 1, from: 0, to: 0, inserted: 3 }),
    { id: 1, index: 7 },
    'Text position map',
  );

  return { assertions, checks: 'passed' };
}
