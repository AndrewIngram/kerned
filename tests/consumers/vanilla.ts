import { createEditor } from '@gprose/core';
import { captureComment, createCommentStore } from '@gprose/extension-comments';
import { commentView } from '@gprose/extension-comments/browser';
import { localHistory } from '@gprose/extension-history';
import { searchView } from '@gprose/extension-search';
import { createSchema } from '@gprose/model';
import { textSelection } from '@gprose/state';
import { mountEditor } from '@gprose/view';

import { note, editing, presentation } from './document';

const host = document.querySelector<HTMLElement>('#editor');

const output = document.querySelector<HTMLOutputElement>('output');

const destroy = document.querySelector<HTMLButtonElement>('#destroy');

if (!host || !output || !destroy) throw new Error('Missing consumer hosts');

const comments = createCommentStore<string>();

const editor = createEditor({
  schema: createSchema({
    extensions: [
      note,
      editing,
      presentation,
      localHistory,
      commentView(comments),
      searchView.configure({ activeColor: '#993366' }),
    ],
  }),
  content: [{ kind: 'note', body: 'Vanilla' }],
});

const stop = editor.subscribe(() => {
  output.value = editor.state.nodes[0].body;
});

const view = mountEditor(host, { editor });

await view.ready;

editor.commands.append(' ready');

editor.select(textSelection(editor.state.nodes[0].id, 0, 7));

const thread = captureComment(editor, 'opening', ['Opening text']);

if (!thread) throw new Error('Missing comment range');

comments.put(thread);

await editor.find.setQueryAsync('ready');

editor.select(textSelection(editor.state.nodes[0].id, editor.state.nodes[0].body.length));

editor.commands.focus();

host.dataset.ready = view.status;

destroy.addEventListener('click', () => {
  view.destroy();
  stop();
  editor.destroy();
  host.dataset.ready = 'destroyed';
});
