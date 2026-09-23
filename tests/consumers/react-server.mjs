import assert from 'node:assert/strict';

import { createEditor } from '@kerned/core';
import { createCommentStore } from '@kerned/extension-comments';
import { commentView } from '@kerned/extension-comments/browser';
import { searchView } from '@kerned/extension-search';
import { createSchema } from '@kerned/model';
import { EditorContent, useEditor, useEditorState } from '@kerned/react';
import { starterBrowserExtensions } from '@kerned/starter-kit/browser';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

// Plain Node must load the same public entries used by an SSR application.
assert.equal('document' in globalThis, false);

assert.match(import.meta.resolve('@kerned/react'), /\/dist\/index\.js$/);

const schema = createSchema({
  extensions: [...starterBrowserExtensions(), searchView, commentView(createCommentStore())],
});

function OwnedEditor() {
  const editor = useEditor({ schema, content: [{ kind: 'paragraph', text: 'Server' }] });
  const text = useEditorState(editor, (state) => state.nodes[0].text);

  return createElement(
    'section',
    null,
    createElement('p', null, text ?? 'Loading'),
    createElement(EditorContent, { editor, className: 'editor' }),
  );
}

assert.equal(
  renderToString(createElement(OwnedEditor)),
  '<section><p>Loading</p><div class="editor"></div></section>',
);

const editor = createEditor({ schema, content: [{ kind: 'paragraph', text: 'Borrowed' }] });

try {
  assert.equal(
    renderToString(createElement(EditorContent, { editor, className: 'editor' })),
    '<div class="editor"></div>',
  );
  assert.equal(editor.isDestroyed, false);
} finally {
  editor.destroy();
}

console.log('Built React SSR consumer passed without CSS loaders or DOM globals');
