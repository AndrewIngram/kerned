import { expect, test } from 'vitest';
import { z } from 'zod';

import { createSchema, defineNode } from '../../model';
import { createEditor, textSelection, type FindStatus } from '../index';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

function session() {
  const compiled = createSchema({ extensions: [note] });
  let reads = 0;

  const schema = {
    ...compiled,
    text(node: Parameters<typeof compiled.text>[0]) {
      reads++;

      return compiled.text(node);
    },
  };

  const editor = createEditor(
    schema,
    [schema.node(note).create({ id: 1, key: 'one' }, { text: 'One idea, another idea.' })],
    textSelection(1, 0),
  );

  return { editor, schema, reads: () => reads };
}

test('subscribers receive query and navigation changes without synchronous reads or transactions', async () => {
  const { editor, reads } = session();
  const initial = editor.state;
  const seen: FindStatus[] = [];
  const stop = editor.find.subscribe(() => seen.push(editor.find.getSnapshot()));
  const before = reads();
  const pending = editor.find.setQueryAsync('idea');
  expect(reads()).toBe(before);
  expect(editor.find.getSnapshot().pending).toBe(true);
  const result = await pending;
  expect(result?.state.matches).toHaveLength(2);
  expect(editor.find.getSnapshot()).toEqual({ state: result?.state, stale: false, pending: false });
  const snapshot = editor.find.getSnapshot();
  expect(editor.find.getSnapshot()).toBe(snapshot);
  editor.find.next();
  expect(editor.find.getSnapshot().state.active?.from).toBe(18);
  expect(editor.state).toBe(initial);
  expect(editor.history.undo).toBe(0);
  expect(seen.at(-1)).toBe(editor.find.getSnapshot());
  stop();
  const count = seen.length;
  editor.find.clear();
  expect(seen).toHaveLength(count);
  editor.destroy();
});

test('edits invalidate ranges immediately and refresh without a host query; undo also refreshes', async () => {
  const { editor } = session();
  editor.find.setQuery('idea');
  editor.dispatch({
    baseRevision: editor.state.revision,
    origin: 'local',
    history: 'separate',
    time: 1,
    steps: [{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'New ' }],
  });
  expect(editor.find.getSnapshot()).toMatchObject({ stale: true, pending: true });
  expect(editor.find.getSnapshot().state.matches).toEqual([]);
  await expect.poll(() => editor.find.getSnapshot().pending).toBe(false);
  expect(editor.find.getSnapshot()).toMatchObject({ stale: false });
  expect(editor.find.getSnapshot().state.active?.from).toBe(8);
  editor.undo();
  expect(editor.find.getSnapshot().stale).toBe(true);
  await expect.poll(() => editor.find.getSnapshot().pending).toBe(false);
  expect(editor.find.getSnapshot().state.active?.from).toBe(4);
  editor.destroy();
});

test('append-only loading retains usable results and extends the current asynchronous request', async () => {
  const { editor, schema } = session();
  editor.find.setQuery('idea');
  const previous = editor.find.getSnapshot().state;
  const pending = editor.find.setQueryAsync('idea');
  editor.dispatch({
    baseRevision: editor.state.revision,
    origin: 'stream',
    history: 'exclude',
    steps: [
      {
        kind: 'append',
        nodes: [schema.node(note).create({ id: 2, key: 'two' }, { text: 'idea' })],
      },
    ],
  });
  expect(editor.find.getSnapshot()).toMatchObject({ stale: false, pending: true });
  expect(editor.find.getSnapshot().state).toBe(previous);
  const result = await pending;
  expect(result?.state.matches).toHaveLength(3);
  expect(result?.nodes).toBe(editor.state.nodes);
  editor.destroy();
});

test('superseded, cleared and destroyed jobs cannot publish later results', async () => {
  const { editor } = session();
  const old = editor.find.setQueryAsync('One');
  const latest = editor.find.setQueryAsync('idea');
  expect(await old).toBeNull();
  expect((await latest)?.state.query).toBe('idea');
  const clearing = editor.find.setQueryAsync('One');
  editor.find.clear();
  expect(await clearing).toBeNull();
  const seen: FindStatus[] = [];
  editor.find.subscribe(() => seen.push(editor.find.getSnapshot()));
  const destroying = editor.find.setQueryAsync('idea');
  editor.destroy();
  const count = seen.length;
  expect(await destroying).toBeNull();
  expect(seen).toHaveLength(count);
  expect(editor.find.getSnapshot().pending).toBe(false);
  expect(() => editor.find.setQuery('idea')).toThrow('destroyed');
  expect(() => editor.find.subscribe(() => {})).toThrow('destroyed');
});

test('empty searches do not rescan the document or notify on selection changes', () => {
  const { editor, reads } = session();
  const seen: FindStatus[] = [];
  editor.find.subscribe(() => seen.push(editor.find.getSnapshot()));
  const snapshot = editor.find.getSnapshot();
  editor.select(textSelection(1, 2));
  const before = reads();
  expect(editor.find.getSnapshot()).toBe(snapshot);
  expect(reads()).toBe(before);
  expect(seen).toHaveLength(0);
  editor.destroy();
});

test('an edit during an unfinished query restarts the latest query without host retries', async () => {
  const { editor } = session();
  editor.find.setQuery('One');
  const pending = editor.find.setQueryAsync('idea');
  editor.dispatch({
    baseRevision: editor.state.revision,
    origin: 'local',
    history: 'separate',
    time: 1,
    steps: [{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'idea ' }],
  });
  expect(await pending).toBeNull();
  await expect.poll(() => editor.find.getSnapshot().pending).toBe(false);
  expect(editor.find.getSnapshot().state.query).toBe('idea');
  expect(editor.find.getSnapshot().state.matches).toHaveLength(3);
  editor.destroy();
});

test('aborting a new query then appending refreshes the last completed query', async () => {
  const { editor, schema } = session();
  editor.find.setQuery('idea');
  const abort = new AbortController();
  const pending = editor.find.setQueryAsync('One', {}, abort.signal);
  abort.abort();
  editor.dispatch({
    baseRevision: editor.state.revision,
    origin: 'stream',
    history: 'exclude',
    steps: [
      {
        kind: 'append',
        nodes: [schema.node(note).create({ id: 2, key: 'two' }, { text: 'idea' })],
      },
    ],
  });
  expect(await pending).toBeNull();
  await expect.poll(() => editor.find.getSnapshot().pending).toBe(false);
  expect(editor.find.getSnapshot().state.query).toBe('idea');
  expect(editor.find.getSnapshot().state.matches).toHaveLength(3);
  editor.destroy();
});

test('aborting a restarted draft query still refreshes invalidated committed results', async () => {
  const { editor } = session();
  editor.find.setQuery('idea');
  const abort = new AbortController();
  const pending = editor.find.setQueryAsync('One', {}, abort.signal);
  editor.dispatch({
    baseRevision: editor.state.revision,
    origin: 'local',
    history: 'separate',
    time: 1,
    steps: [{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'idea ' }],
  });
  abort.abort();
  expect(await pending).toBeNull();
  await expect.poll(() => editor.find.getSnapshot().pending).toBe(false);
  expect(editor.find.getSnapshot().stale).toBe(false);
  expect(editor.find.getSnapshot().state.query).toBe('idea');
  expect(editor.find.getSnapshot().state.matches).toHaveLength(3);
  editor.destroy();
});
