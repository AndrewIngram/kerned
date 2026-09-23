import { createEditor } from '@kerned/core';
import { createSchema, defineNode, type DocumentNode } from '@kerned/model';
import { textSelection, TextSelection } from '@kerned/state';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { createProtectedAuthority } from '../protected/authority.js';
import { createTextReplica } from '../replica.js';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.object({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

const definitions = [note] as const;

type Node = DocumentNode<typeof definitions>;

function fixture(protectedBlock = false) {
  const schema = createSchema({ extensions: definitions });

  const authority = createProtectedAuthority({
    schema,
    delivery: { kind: 'json' },
    nodes: [
      schema.node(note).create({ id: 1, key: 'one' }, { text: 'abc' }),
      schema.node(note).create({ id: 2, key: 'two' }, { text: 'private' }),
      schema.node(note).create({ id: 3, key: 'three' }, { text: 'last' }),
    ],
    users: { writer: 'editable' },
    comments: [],
    attachments: [],
    title: () => null,
  });

  if (protectedBlock) authority.setAccess('writer', 'two', 'protected');
  const frames: Uint8Array[] = [];
  const connection = authority.connect('writer', (bytes) => frames.push(bytes));
  const replica = createTextReplica<Node>(connection.session);

  function deliver() {
    connection.flush();

    for (const bytes of frames.splice(0)) replica.receive(bytes);
  }

  deliver();
  const clientSchema = createSchema({ extensions: [note, replica.extension] });

  const editor = createEditor({
    schema: clientSchema,
    document: replica.document(clientSchema, (identity) =>
      clientSchema.node(note).create(identity, { text: '' }),
    ),
    selection: textSelection(1, 0),
    permissions: replica.permissions,
  });

  replica.bind(editor);

  return {
    authority,
    replica,
    editor,
    connection,
    frames,
    deliver,
    destroy(this: void) {
      replica.destroy();
      editor.destroy();
      authority.destroy();
    },
  };
}

test('remote text maps the local caret once and does not echo a local request', ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(f.destroy);
  f.editor.select(textSelection(1, 2));
  f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 0, text: '🙂' }]);
  f.deliver();
  expect(f.editor.schema.text(f.editor.state.nodes[0])).toBe('🙂abc');
  expect(f.editor.state.selection).toEqual(textSelection(1, 4));
  expect(f.replica.pending).toBe(0);
  expect(f.replica.request()).toBeNull();
  expect(f.editor.state.selection).toBeInstanceOf(TextSelection);
});

test('revoking access closes an existing mounted binding instead of retaining its old projection', ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(f.destroy);
  f.authority.setAccess('writer', 'two', 'protected');
  expect(f.deliver).toThrow(/Reconnect/);
  expect(f.editor.isDestroyed).toBe(true);
});

test('one transaction can queue sequential edits with optimistic coordinates', ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(f.destroy);
  f.editor.dispatch({
    origin: 'local',
    history: 'separate',
    time: 0,
    baseRevision: 0,
    steps: [
      { kind: 'replaceText', id: 1, from: 0, to: 0, text: 'A' },
      { kind: 'replaceText', id: 1, from: 1, to: 1, text: 'B' },
    ],
    selection: textSelection(1, 2),
  });
  expect(f.replica.pending).toBe(2);

  for (let i = 0; i < 2; i++) {
    const bytes = f.replica.request();

    if (!bytes) throw new Error('Missing request');
    f.connection.submit(bytes);
    f.deliver();
  }

  expect(f.editor.schema.text(f.editor.state.nodes[0])).toBe('ABabc');
  expect(f.replica.pending).toBe(0);
  expect(f.editor.state.selection).toEqual(textSelection(1, 2));
});

test('a local range crossing an opaque block is kept local and never published as presence', ({
  onTestFinished,
}) => {
  const f = fixture(true);
  onTestFinished(f.destroy);
  f.editor.select(new TextSelection({ id: 1, offset: 0 }, { id: 3, offset: 2 }));
  const bytes = f.replica.presence();

  if (!bytes) throw new Error('Missing presence packet');
  expect(JSON.parse(new TextDecoder().decode(bytes))).toMatchObject({ selection: null });
  expect(f.editor.state.selection).toEqual(
    new TextSelection({ id: 1, offset: 0 }, { id: 3, offset: 2 }),
  );
});

test('a delivery gap closes the editor before another local change can publish', ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(f.destroy);
  f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'A' }]);
  f.connection.flush();
  f.frames.splice(0);
  f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'B' }]);
  expect(f.deliver).toThrow(/Delivery gap/);
  expect(f.editor.isDestroyed).toBe(true);
  expect(() =>
    f.editor.dispatch({
      origin: 'local',
      history: 'separate',
      time: 0,
      baseRevision: 0,
      steps: [{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'lost' }],
    }),
  ).toThrow(/destroyed/i);
  expect(f.replica.request()).toBeNull();
  expect(f.replica.presence()).toBeNull();
});

test('malformed delivery closes the binding while duplicate frames remain harmless', ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(f.destroy);
  f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'A' }]);
  f.connection.flush();
  const bytes = f.frames[0];
  expect(f.replica.receive(bytes)).toBe(true);
  expect(f.replica.receive(bytes)).toBe(false);
  expect(f.editor.isDestroyed).toBe(false);
  expect(() => f.replica.receive(new TextEncoder().encode('invalid'))).toThrow(SyntaxError);
  expect(f.editor.isDestroyed).toBe(true);
  expect(f.replica.request()).toBeNull();
});

test('editor destruction releases the binding and rejects further delivery', ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(f.destroy);
  f.editor.destroy();
  expect(f.replica.request()).toBeNull();
  expect(f.replica.presence()).toBeNull();
  expect(() => f.replica.receive(new Uint8Array())).toThrow(/destroyed/i);
});
