import { createEditor, defineExtension, type ContributionContext } from '@gprose/core';
import { createSchema } from '@gprose/model';
import { TextSelection, textSelection } from '@gprose/state';
import { expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { defineNodeView, nodeViews } from '../src/editor-browser';
import { mountEditor } from '../src/editor-canvas';
import { quote } from '../src/extensions/starter-definitions';
import { starterBrowserExtensions } from '../src/extensions/starter-kit/browser';

const chrome = defineExtension({
  name: 'quoteChrome',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(
      nodeViews,
      defineNodeView(quote, () => (element) => {
        element.style.cssText = 'padding:20px;background:rgb(245, 240, 230)';
        const body = document.createElement('div');
        body.dataset.quoteSlot = '';
        element.append(body);
        let release: (() => void) | undefined;

        return {
          update({ content }) {
            if (!release && content) release = content.attach(body);
          },
          destroy() {
            release?.();
          },
        };
      }),
    );

    return {};
  },
});

test('slot descendants use ordinary pointer selection, text input, rich clipboard and undo across the container edge', async ({
  onTestFinished,
}) => {
  const editor = createEditor({
    schema: createSchema({ extensions: [...starterBrowserExtensions(), chrome] }),
    content: [
      { kind: 'quote', id: 1, children: [{ kind: 'paragraph', id: 2, text: 'Inside' }] },
      { kind: 'paragraph', id: 3, text: 'Outside' },
    ],
  });

  const element = document.createElement('div');
  element.style.cssText = 'width:500px;height:300px';
  document.body.append(element);
  const view = mountEditor(element, { editor });
  onTestFinished(() => {
    view.destroy();
    editor.destroy();
    element.remove();
  });
  await view.ready;
  await expect.poll(() => view.blockBounds(2)?.top).toBe(52);
  const body = element.querySelector<HTMLElement>('[data-quote-slot]');
  const input = element.querySelector<HTMLTextAreaElement>('[data-editor-input]');

  if (!body || !input) throw new Error('Missing slot or shared input');
  await userEvent.click(body, { position: { x: 100, y: 10 } });
  expect(editor.state.selection).toBeInstanceOf(TextSelection);

  if (!(editor.state.selection instanceof TextSelection))
    throw new Error('Expected text selection');
  expect(editor.state.selection.head.id).toBe(2);
  editor.select(textSelection(2, 6));
  view.focus();
  await userEvent.keyboard('!');
  await expect
    .poll(() =>
      editor.schema.text(
        editor.state.nodes[0].kind === 'quote'
          ? editor.state.nodes[0].children[0]
          : editor.state.nodes[0],
      ),
    )
    .toBe('Inside!');
  expect(editor.commands.undo()).toBe(true);
  await expect
    .poll(() =>
      editor.schema.text(
        editor.state.nodes[0].kind === 'quote'
          ? editor.state.nodes[0].children[0]
          : editor.state.nodes[0],
      ),
    )
    .toBe('Inside');
  editor.select(new TextSelection({ id: 2, offset: 0 }, { id: 3, offset: 7 }));
  view.focus();
  const copied = new DataTransfer();

  const copy = new ClipboardEvent('copy', {
    clipboardData: copied,
    bubbles: true,
    cancelable: true,
  });

  input.dispatchEvent(copy);
  expect(copy.defaultPrevented).toBe(true);
  expect(copy.clipboardData?.getData('text/plain')).toContain('Inside');
  expect(copy.clipboardData?.getData('text/plain')).toContain('Outside');
  expect(copy.clipboardData?.getData('text/html')).toContain('<blockquote>');
  const before = editor.state.nodes;
  await userEvent.keyboard('R');
  await expect.poll(() => editor.state.nodes).not.toBe(before);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.nodes).toEqual(before);
});
