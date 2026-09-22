import { createEditor, createEditorSerializer } from '@gprose/core';
import { createSchema } from '@gprose/model';
import { starterBrowserExtensions } from '@gprose/starter-kit/browser';
import { textSelection } from '@gprose/state';
import { mountEditor } from '@gprose/view';

const host = document.querySelector<HTMLElement>('#editor');

const output = document.querySelector<HTMLOutputElement>('output');

const quote = document.querySelector<HTMLButtonElement>('#quote');

const undo = document.querySelector<HTMLButtonElement>('#undo');

const destroy = document.querySelector<HTMLButtonElement>('#destroy');

if (!host || !output || !quote || !undo || !destroy) throw new Error('Missing consumer hosts');

const editor = createEditor({
  schema: createSchema({ extensions: starterBrowserExtensions() }),
  content: [{ kind: 'paragraph', text: 'Starter' }],
});

const serializer = createEditorSerializer(editor);

const stop = editor.subscribe(() => {
  output.value = serializer.serialize(editor.state.nodes).html;
});

const view = mountEditor(host, { editor });

await view.ready;

editor.select(textSelection(editor.state.nodes[0].id, 7));

editor.commands.focus();

host.dataset.ready = view.status;

quote.addEventListener('click', () => editor.commands.toggleQuote());

undo.addEventListener('click', () => editor.commands.undo());

destroy.addEventListener('click', () => {
  view.destroy();
  stop();
  editor.destroy();
  host.dataset.ready = 'destroyed';
});
