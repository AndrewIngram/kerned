import { createEditor, defineExtension, type ContributionContext } from '@gprose/core';
import { createSchema, defineNode } from '@gprose/model';
import { textSelection } from '@gprose/state';
import { nodeViews } from '@gprose/view';
import { defineNodePresentation, presentations, type MountedEditor } from '@gprose/view';
import { createContext, StrictMode, useContext, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import { page, server, userEvent } from 'vitest/browser';
import { z } from 'zod';

import {
  defineReactNodeView,
  EditorContent,
  NodeViewContent,
  type ReactNodeViewProps,
} from '../index.js';

const paragraph = defineNode({
  name: 'paragraph',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.object({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

const callout = defineNode({
  name: 'callout',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.object({}),
    content: { kind: 'container', field: 'children', allowedGroups: ['block'] },
  }),
});

const Theme = createContext('Missing context');

const size = { width: 420, height: 300 };

function Callout({ node, content, selection, access }: ReactNodeViewProps<typeof callout>) {
  const theme = useContext(Theme);
  const [expanded, expand] = useState(false);

  return (
    <section
      data-callout={node.id}
      data-selection={selection.kind}
      data-access={access}
      style={{ padding: '12px 16px', background: 'rgb(240, 220, 200)' }}
    >
      <button
        style={{ display: 'block', height: expanded ? 64 : 24, padding: 0, border: 0 }}
        onClick={() => expand(true)}
      >
        {theme}
      </button>
      <NodeViewContent content={content} />
    </section>
  );
}

const rendering = defineExtension({
  name: 'rendering',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(
      presentations,
      defineNodePresentation(paragraph, () => ({ text }) => ({
        kind: 'text',
        text,
        size: 16,
        lineHeight: 24,
        before: 0,
        after: 12,
        baselineGrid: 0,
        spans: [],
        atoms: [],
      })),
    );
    context.provide(
      presentations,
      defineNodePresentation(callout, () => () => ({
        kind: 'flow',
        child: (_index, inherited) => inherited,
      })),
    );
    context.provide(nodeViews, defineReactNodeView(callout, Callout));

    return {};
  },
});

test('React content slots share context, scoped selection and live access while Strict Mode retains one canvas and input owner', async ({
  onTestFinished,
}) => {
  let writable = true;

  const editor = createEditor({
    schema: createSchema({ extensions: [paragraph, callout, rendering] }),
    permissions: { access: () => (writable ? 'editable' : 'read-only') },
    content: [
      {
        kind: 'callout',
        id: 1,
        children: [{ kind: 'paragraph', id: 2, text: 'Canvas text inside React chrome.' }],
      },
      { kind: 'paragraph', id: 3, text: 'Outside the callout.' },
    ],
  });

  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  let ready: ((view: MountedEditor) => void) | undefined;

  const readiness = new Promise<MountedEditor>((resolve) => {
    ready = resolve;
  });

  onTestFinished(() => {
    flushSync(() => root.unmount());
    editor.destroy();
    element.remove();
  });

  const callbacks = {
    ready(this: void, view: MountedEditor) {
      ready?.(view);
    },
  };

  root.render(
    <StrictMode>
      <Theme value="Shared context">
        <EditorContent editor={editor} style={size} onReady={callbacks.ready} />
      </Theme>
    </StrictMode>,
  );
  const view = await readiness;
  await expect.poll(() => view.blockBounds(2)?.top).toBe(68);
  const chrome = element.querySelector<HTMLElement>('[data-callout]');
  const body = chrome?.querySelector<HTMLElement>('[data-editor-slot]');
  const button = chrome?.querySelector('button');

  if (!chrome || !body || !button) throw new Error('Missing React slot');
  expect(button.textContent).toBe('Shared context');
  expect(view.blockBounds(2)?.left).toBe(44);
  expect(view.blockBounds(2)?.width).toBe(332);
  expect(view.blockBounds(2, 'client')?.top).toBeCloseTo(body.getBoundingClientRect().top);
  expect(view.getSnapshot()?.viewport.top).toBe(0);
  const caretTop = view.coordsAt({ id: 2, offset: 0 })?.top ?? 0;
  const revision = editor.state.revision;
  button.focus();
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => view.blockBounds(2)?.top).toBe(108);
  expect(document.activeElement).toBe(button);
  expect(view.coordsAt({ id: 2, offset: 0 })?.top).toBeCloseTo(caretTop + 40);
  expect(editor.state.revision).toBe(revision);
  editor.select(textSelection(2, 3));
  await expect.poll(() => chrome.dataset.selection).toBe('caret');
  const bounds = view.blockBounds(2);
  writable = false;
  editor.refreshPermissions();
  await expect.poll(() => chrome.dataset.access).toBe('read-only');
  expect(view.blockBounds(2)).toEqual(bounds);
  expect(element.querySelector('[data-callout]')).toBe(chrome);
  expect(element.querySelectorAll('canvas')).toHaveLength(1);
  expect(element.querySelectorAll('[data-editor-input]')).toHaveLength(1);
  expect(body.textContent).toBe('');
  const canvas = element.querySelector('canvas');

  if (!canvas) throw new Error('Missing shared canvas');
  const context = canvas.getContext('2d');

  if (!context) throw new Error('Missing software canvas');
  // The DOM chrome must remain visible through canvas pixels away from text.
  await expect.poll(() => context.getImageData(0, 0, 1, 1).data[3]).toBe(0);
  await expect
    .poll(() => {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let visible = 0;

      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) visible++;

      return visible;
    })
    .toBeGreaterThan(100);
  await page.screenshot({
    element,
    path: `../../../../artifacts/public-interface-m6/content-slots/react-${server.browser}.png`,
  });
  writable = true;
  editor.refreshPermissions();

  const notes = Array.from({ length: 100 }, (_, index) =>
    editor.schema
      .node(paragraph)
      .create({ id: 100 + index, key: `extra-${index}` }, { text: `Extra paragraph ${index}` }),
  );

  editor.transact((draft) => {
    draft.step({ kind: 'replaceChildren', parent: null, index: 2, count: 0, nodes: notes });

    return true;
  });
  editor.select(textSelection(199, 0));
  await view.reveal({ id: 199, offset: 0 });
  expect(element.querySelector('[data-callout]')).toBe(chrome);
  const external = document.createElement('input');
  external.style.cssText = 'position:fixed;top:0;right:0;width:30px;z-index:100';
  document.body.append(external);
  onTestFinished(() => external.remove());
  await userEvent.click(external);
  await expect.poll(() => element.querySelector('[data-callout]')).toBeNull();
  editor.select(textSelection(2, 0));
  await view.reveal({ id: 2, offset: 0 });
  await expect.poll(() => view.blockBounds(2)?.top).toBe(68);
  expect(element.querySelector('[data-callout]')).not.toBe(chrome);
  expect(element.querySelector('[data-callout] button')?.textContent).toBe('Shared context');
});
