import { createEditor } from '@kerned/core';
import { renderToString } from 'react-dom/server';
import { expect, test } from 'vitest';

import { createEditorContext, EditorContent, useEditor, useEditorState } from '../index.js';
import { ownershipFixture } from './ownership-fixture.js';

test('the public React entry renders on a server without creating sessions or views', () => {
  const f = ownershipFixture();

  function ServerEditor() {
    const editor = useEditor({ schema: f.schema, content: [{ kind: 'note', text: 'Server' }] });
    const text = useEditorState(editor, (state) => state.nodes[0].text);

    return (
      <section>
        <p>{text ?? 'Loading'}</p>
        <EditorContent editor={editor} className="editor" />
      </section>
    );
  }

  expect('document' in globalThis).toBe(false);
  expect(renderToString(<ServerEditor />)).toBe(
    '<section><p>Loading</p><div class="editor"></div></section>',
  );
  expect(f.events).toEqual([]);
});

test('schema-bound context rejects a missing provider and a different schema instance', () => {
  const f = ownershipFixture();
  const other = ownershipFixture();
  const editor = createEditor({ schema: other.schema, content: [] });
  const { EditorProvider, useCurrentEditor } = createEditorContext(f.schema);

  function Consumer() {
    const current = useCurrentEditor();

    return <p>{current ? 'Ready' : 'Loading'}</p>;
  }

  try {
    expect(() => renderToString(<Consumer />)).toThrow(/requires its EditorProvider/);
    expect(() =>
      renderToString(
        <EditorProvider editor={editor}>
          <Consumer />
        </EditorProvider>,
      ),
    ).toThrow(/bound schema/);
    expect(
      renderToString(
        <EditorProvider editor={null}>
          <Consumer />
        </EditorProvider>,
      ),
    ).toBe('<p>Loading</p>');
    expect(renderToString(<EditorContent editor={editor} />)).toBe('<div></div>');
    expect(editor.isDestroyed).toBe(false);
  } finally {
    editor.destroy();
  }
});
