import assert from 'node:assert/strict';

import { createEditor, defineExtension } from '@gprose/core';
import { createSchema, defineNode, defineExtension as modelExtension } from '@gprose/model';
import { TextSelection, Selection, textSelection } from '@gprose/state';
import { mapPosition } from '@gprose/transform';
import { z } from 'zod';

// This fixture runs in Node with no TypeScript loader or source export condition.
assert.equal(defineExtension, modelExtension);

assert.equal('document' in globalThis, false);

for (const name of ['model', 'transform', 'state', 'core']) {
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

const schema = createSchema({ extensions: [note, editing] });

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

editor.destroy();

assert.equal(editor.isDestroyed, true);

console.log(
  'Built headless packages: custom schema, commands, selection identity and private exports pass.',
);
