import { createEditor } from '@gprose/core';
import { createSchema } from '@gprose/model';
import { textSelection } from '@gprose/state';
import { mountEditor } from '@gprose/view';

import { note, editing, presentation } from './document';

const host = document.querySelector<HTMLElement>('#editor');

const output = document.querySelector<HTMLOutputElement>('output');

const destroy = document.querySelector<HTMLButtonElement>('#destroy');

if (!host || !output || !destroy) throw new Error('Missing consumer hosts');

const editor = createEditor({
  schema: createSchema({ extensions: [note, editing, presentation] }),
  content: [{ kind: 'note', body: 'Vanilla' }],
});

const stop = editor.subscribe(() => {
  output.value = editor.state.nodes[0].body;
});

const view = mountEditor(host, { editor });

await view.ready;

editor.commands.append(' ready');

editor.select(textSelection(editor.state.nodes[0].id, editor.state.nodes[0].body.length));

editor.commands.focus();

host.dataset.ready = view.status;

destroy.addEventListener('click', () => {
  view.destroy();
  stop();
  editor.destroy();
  host.dataset.ready = 'destroyed';
});
