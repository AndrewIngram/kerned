import assert from 'node:assert/strict';

import { createEditor, defineExtension } from '@gprose/core';
import {
  captureComment,
  createCommentStore,
  createCommentProjection,
} from '@gprose/extension-comments';
import { paragraph } from '@gprose/extension-document';
import { localHistory } from '@gprose/extension-history';
import { createOutlineExtension } from '@gprose/extension-outline';
import {
  table,
  tableCell,
  tableEditing,
  tableCells,
  tableRows,
  tableSerializers,
} from '@gprose/extension-table';
import {
  createSchema,
  defineNode,
  createDocumentCodec,
  createDocumentSerializer,
  defineNodeSerializer,
  defineExtension as modelExtension,
} from '@gprose/model';
import { TextSelection, Selection, textSelection } from '@gprose/state';
import { mapPosition } from '@gprose/transform';
import { z } from 'zod';

// This fixture runs in Node with no TypeScript loader or source export condition.
assert.equal(defineExtension, modelExtension);

assert.equal('document' in globalThis, false);

for (const name of [
  'model',
  'transform',
  'state',
  'core',
  'extension-comments',
  'extension-history',
  'extension-outline',
  'extension-document',
  'extension-table',
]) {
  assert.match(import.meta.resolve(`@gprose/${name}`), /\/dist\/index\.js$/);
  assert.throws(() => import.meta.resolve(`@gprose/${name}/src/index.ts`), {
    code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
  });
}

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
      append: {
        execute(context, text) {
          const node = context.state.nodes[0];
          context.step({
            kind: 'replaceText',
            id: node.id,
            from: node.text.length,
            to: node.text.length,
            text,
          });

          return true;
        },
      },
    },
  }),
});

const schema = createSchema({ extensions: [note, editing, localHistory] });

const editor = createEditor({ schema, content: [{ kind: 'note', text: 'Hello' }] });

const node = editor.state.nodes[0];

editor.select(textSelection(node.id, 5));

assert.ok(editor.state.selection instanceof TextSelection);

assert.ok(editor.state.selection instanceof Selection);

const initial = editor.state;

assert.equal(editor.can().append('!'), true);

assert.equal(editor.state, initial);

assert.equal(editor.chain().append(' world').append('!').run(), true);

assert.equal(editor.state.nodes[0].text, 'Hello world!');

assert.deepEqual(
  mapPosition(node.id, 5, 1, { kind: 'replace', id: node.id, from: 5, to: 5, inserted: 7 }),
  { id: node.id, index: 12 },
);

// Feature state and outline extraction work with an unrelated consumer schema.
editor.select(textSelection(node.id, 0, 5));

const comment = captureComment(editor, 'review', ['Keep this opening']);

assert.ok(comment);

const comments = createCommentStore([comment]);

const project = createCommentProjection(editor, comments);

assert.deepEqual(project().text.get(node.id), [{ id: 'review', from: 0, to: 5 }]);

const outline = createOutlineExtension(schema, (value) => ({ level: 1, title: value.text }));

const headings = outline.read(editor.state.nodes);

assert.equal(headings[0].title, 'Hello world!');

assert.equal(outline.read(editor.state.nodes), headings);

assert.equal(editor.commands.undo(), true);

assert.equal(editor.state.nodes[0].text, 'Hello');

assert.equal(comments.state.threads[0], comment);

assert.deepEqual(project().text.get(node.id), [{ id: 'review', from: 0, to: 5 }]);

assert.equal(outline.read(editor.state.nodes)[0].title, 'Hello');

assert.equal(editor.commands.redo(), true);

assert.equal(editor.state.nodes[0].text, 'Hello world!');

editor.destroy();

assert.equal(editor.isDestroyed, true);

console.log(
  'Built headless packages: custom schema, commands, history, comments, outline, selection identity and private exports pass.',
);

// Tables assemble without the starter kit, browser exports or default document union.
const grid = createEditor({
  schema: createSchema({ extensions: [paragraph, table, tableCell, tableEditing, localHistory] }),
  content: [{ kind: 'paragraph', text: 'Intro' }],
});

const intro = grid.state.nodes[0];

grid.select(textSelection(intro.id, 0));

assert.equal(grid.commands.insertTable(), true);

const inserted = grid.state.nodes[1];

const rows = tableRows(grid.schema, inserted);

assert.equal(rows.length, 3);

assert.equal(rows[0].length, 3);

grid.select(new tableCells.CellSelection(inserted.id, rows[0][0].id, rows[0][0].id));

assert.equal(grid.chain().addTableRow().addTableColumn().run(), true);

const expanded = tableRows(grid.schema, grid.state.nodes[1]);

assert.equal(expanded.length, 4);

assert.equal(expanded[0].length, 4);

assert.equal(grid.commands.undo(), true);

assert.deepEqual(tableRows(grid.schema, grid.state.nodes[1]), rows);

const gridCodec = createDocumentCodec(grid.schema);

assert.deepEqual(
  gridCodec.encode(gridCodec.decode(gridCodec.encode(grid.state.nodes))),
  gridCodec.encode(grid.state.nodes),
);

const gridSerializer = createDocumentSerializer(grid.schema, [
  ...tableSerializers,
  defineNodeSerializer(paragraph, ({ content }) => ({
    ...content,
    html: [{ tag: 'p', children: content.html }],
  })),
]);

assert.match(gridSerializer.serialize(grid.state.nodes).html, /<table><caption><\/caption><tr>/);

grid.destroy();

console.log(
  'Built table package: standalone assembly, cell selection, grid commands and undo pass.',
);
