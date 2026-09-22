import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const result = execFileSync(
  process.execPath,
  [
    '--experimental-transform-types',
    '--import',
    `data:text/javascript,import {register} from 'node:module'; register(${JSON.stringify(new URL('../tests/fixtures/node-typescript-loader.mjs', import.meta.url).href)});`,
    '--input-type=module',
    '-e',
    `
      import assert from 'node:assert/strict';
      import {createEditor, createEditorSerializer} from './src/core/index.ts';
      import {createSchema} from './src/model/index.ts';
      import {textSelection} from './src/state/index.ts';
      import {starterExtensions} from './src/extensions/starter-kit/index.ts';
      const editor = createEditor({
        schema: createSchema({extensions: starterExtensions}),
        content: [{kind: 'paragraph', id: 1, text: 'Hello'}],
        selection: textSelection(1, 5),
      });
      assert.equal(editor.commands.paste({nodes: editor.state.nodes, inline: true}), true);
      assert.equal(createEditorSerializer(editor).serialize(editor.state.nodes).html, '<p>HelloHello</p>');
      assert.equal(editor.commands.undo(), true);
      assert.equal(editor.state.nodes[0].text, 'Hello');
      assert.equal('document' in globalThis, false);
      editor.destroy();
      process.stdout.write('headless ok');
    `,
  ],
  { encoding: 'utf8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] },
);

assert.equal(result, 'headless ok');

console.log('Starter kit imports and edits in ordinary Node without browser loaders.');
