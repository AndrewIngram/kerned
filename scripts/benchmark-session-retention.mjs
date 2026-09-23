import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEditor, defineCommand, defineExtension } from '@kerned/core';
import { localHistory } from '@kerned/extension-history';
import { createSchema, defineNode } from '@kerned/model';
import { textSelection } from '@kerned/state';
import { z } from 'zod';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

const editing = defineExtension({
  name: 'editing',
  options: {},
  setup: () => ({
    commands: {
      append: defineCommand({
        execute(context) {
          const node = context.state.nodes[0];
          const offset = node.text.length;
          context.apply({
            steps: [{ kind: 'replaceText', id: node.id, from: offset, to: offset, text: 'x' }],
            selection: textSelection(node.id, offset + 1),
          });

          return true;
        },
      }),
    },
  }),
});

function heap() {
  global.gc();
  global.gc();

  return process.memoryUsage().heapUsed;
}

function measure(edits, history) {
  const schema = createSchema({
    extensions: history ? [note, editing, localHistory] : [note, editing],
  });

  const editor = createEditor({
    schema,
    documentId: 'retention',
    content: [{ kind: 'note', id: 1, key: 'one', text: 'Initial text' }],
    selection: textSelection(1, 12),
  });

  const position = editor.positions.at(1, 12, 1);
  const before = heap();
  const started = performance.now();

  for (let i = 0; i < edits; i++)
    assert.equal(
      editor
        .chain({ history: { group: 'typing' }, time: i })
        .append()
        .run(),
      true,
    );
  const editMs = performance.now() - started;
  const heapBytes = heap() - before;
  assert.deepEqual(editor.positions.resolve(position), {
    status: 'resolved',
    point: { id: 1, offset: 12 + edits },
  });
  const saveStarted = performance.now();
  const checkpoint = editor.positions.checkpoint();
  const serialized = JSON.stringify(checkpoint);
  const checkpointMs = performance.now() - saveStarted;
  const loadStarted = performance.now();

  const reopened = createEditor({
    schema,
    documentId: editor.documentId,
    document: editor.state.nodes,
    revision: editor.state.revision,
    positionCheckpoint: JSON.parse(serialized),
  });

  const checkpointLoadMs = performance.now() - loadStarted;
  assert.deepEqual(reopened.positions.resolve(position), editor.positions.resolve(position));
  reopened.destroy();

  const result = {
    edits,
    history,
    heapBytes,
    editMs,
    checkpointBytes: Buffer.byteLength(serialized),
    checkpointMs,
    checkpointLoadMs,
    definitions: checkpoint.definitions.length,
    events: checkpoint.events.length,
    undoGroups: editor.history.undo,
  };

  if (history) {
    const undoStarted = performance.now();
    assert.equal(editor.commands.undo(), true);
    result.undoMs = performance.now() - undoStarted;
    assert.equal(editor.state.nodes[0].text, 'Initial text');
    assert.deepEqual(editor.positions.resolve(position), {
      status: 'resolved',
      point: { id: 1, offset: 12 },
    });
    assert.equal(editor.commands.redo(), true);
    assert.equal(editor.state.nodes[0].text.length, 12 + edits);
    assert.deepEqual(editor.positions.resolve(position), {
      status: 'resolved',
      point: { id: 1, offset: 12 + edits },
    });
  }

  editor.destroy();

  return result;
}

if (process.argv[2] === '--case') {
  const edits = Number(process.argv[3]);
  assert.ok(Number.isSafeInteger(edits) && edits > 0 && edits <= 100000);
  assert.ok(['true', 'false'].includes(process.argv[4]));
  measure(100, false);
  console.log(JSON.stringify(measure(edits, process.argv[4] === 'true')));
} else {
  const cases = [];

  // Each case has its own process/heap; previous reports cannot bias retention.
  for (let trial = 0; trial < 3; trial++)
    for (const edits of [1000, 5000])
      for (const history of [false, true]) {
        const value = execFileSync(
          process.execPath,
          ['--expose-gc', fileURLToPath(import.meta.url), '--case', String(edits), String(history)],
          { encoding: 'utf8' },
        );

        const result = { trial, ...JSON.parse(value) };
        cases.push(result);
        console.log(result);
      }

  const filename = process.env.RETENTION_REPORT ?? 'artifacts/editor-session-retention.json';
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(
    filename,
    JSON.stringify(
      { node: process.version, recordedAt: new Date().toISOString(), cases },
      null,
      2,
    ) + '\n',
  );
}
