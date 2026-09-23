import { createEditor, defineExtension, type ContributionContext } from '@kerned/core';
import { createSchema, defineNode } from '@kerned/model';
import {
  EditorContent,
  defineReactNodeView,
  useEditorState,
  type ReactNodeViewProps,
} from '@kerned/react';
import { defineNodePresentation, nodeViews, presentations } from '@kerned/view';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';

import { note, editing, presentation } from './document';

const card = defineNode({
  name: 'card',
  version: 1,
  options: {},
  schema: () => ({ attributes: z.strictObject({ label: z.string() }), content: { kind: 'atom' } }),
});

function Card({ attributes }: ReactNodeViewProps<typeof card>) {
  const [clicks, setClicks] = useState(0);

  return (
    <button onClick={() => setClicks(clicks + 1)}>
      {attributes.label}: {clicks}
    </button>
  );
}

const cardView = defineExtension({
  name: 'cardView',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(
      presentations,
      defineNodePresentation(card, () => () => ({
        kind: 'box',
        height: 60,
        before: 0,
        after: 16,
        baselineGrid: 4,
      })),
    );
    context.provide(nodeViews, defineReactNodeView(card, Card));

    return {};
  },
});

const editor = createEditor({
  schema: createSchema({ extensions: [note, card, editing, presentation, cardView] }),
  content: [
    { kind: 'note', body: 'React' },
    { kind: 'card', label: 'Custom node' },
  ],
});

const editorSize = { width: 500, height: 300 };

function ready() {
  document.body.dataset.ready = 'ready';
}

function Application() {
  const text = useEditorState(editor, (state) => {
    const first = state.nodes[0];

    return first.kind === 'note' ? first.body : '';
  });

  return (
    <>
      <button onClick={() => editor.commands.append('!')}>Append</button>
      <output>{text}</output>
      <EditorContent editor={editor} style={editorSize} onReady={ready} />
    </>
  );
}

const host = document.querySelector<HTMLElement>('#editor');

const destroy = document.querySelector<HTMLButtonElement>('#destroy');

if (!host || !destroy) throw new Error('Missing consumer hosts');

const root = createRoot(host);

root.render(
  <StrictMode>
    <Application />
  </StrictMode>,
);

destroy.addEventListener('click', () => {
  root.unmount();
  editor.destroy();
  document.body.dataset.ready = 'destroyed';
});
