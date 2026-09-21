import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { createEditor } from '../../core';
import { createSchema, defineNode } from '../../model';
import { Editor } from '../editor';

const schema = createSchema({
  extensions: [
    defineNode({
      name: 'note',
      version: 1,
      options: {},
      schema: () => ({
        attributes: z.strictObject({ text: z.string() }),
        content: { kind: 'text', field: 'text' },
      }),
    }),
  ],
});

const session = () => createEditor({ schema, content: [{ kind: 'note', text: 'A' }] });

function view(editor: ReturnType<typeof session>, focus: () => void) {
  return {
    session: editor,
    pointer: {
      selection: () => editor.state.selection,
      onSelect: editor.select,
      hitTest: () => null,
      focus,
    },
  };
}

test('React remounts on session replacement and tolerates updates after borrowed session destruction', () => {
  const first = session();
  const second = session();
  const observed: string[] = [];
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const firstView = view(first, () => observed.push('first'));
  const secondView = view(second, () => observed.push('second'));

  try {
    flushSync(() => root.render(<Editor view={firstView}>First</Editor>));
    first.commands.focus();
    expect(observed).toEqual(['first']);
    flushSync(() => root.render(<Editor view={secondView}>Second</Editor>));
    first.commands.focus();
    second.commands.focus();
    expect(observed).toEqual(['first', 'second']);
    expect(first.isDestroyed).toBe(false);
    second.destroy();
    flushSync(() => root.render(<Editor view={secondView}>Closed</Editor>));
    expect(host.textContent).toBe('Closed');
    expect(() => second.commands.focus()).toThrow(/destroyed/);
    flushSync(() =>
      root.render(
        <Editor key="closed" view={secondView}>
          Still closed
        </Editor>,
      ),
    );
    expect(host.textContent).toBe('Still closed');
  } finally {
    flushSync(() => root.unmount());
    host.remove();
    first.destroy();
    second.destroy();
  }
});
