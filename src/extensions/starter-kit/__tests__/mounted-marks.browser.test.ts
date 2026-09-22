import { createEditor, defineExtension, type ContributionContext } from '@gprose/core';
import { formattingCommands } from '@gprose/extension-document';
import { tableView } from '@gprose/extension-table/browser';
import { createSchema, defineNode } from '@gprose/model';
import { textSelection } from '@gprose/state';
import { mountEditor, presentations, defineNodePresentation } from '@gprose/view';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { containerDecorations, imageView, starterInput, underlineView } from '../browser';
import { starterExtensions } from '../index';
import { starterPresentation } from '../presentation';

const caption = defineNode({
  name: 'caption',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block', 'textblock'],
    attributes: z.strictObject({ body: z.string() }),
    content: { kind: 'text', field: 'body', marks: 'styles' },
  }),
});

const captionView = defineExtension({
  name: 'captionView',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(
      presentations,
      defineNodePresentation(caption, () => (attributes) => ({
        kind: 'text',
        text: attributes.body,
        size: 18,
        lineHeight: 28,
        before: 0,
        after: 16,
        baselineGrid: 4,
        spans: [],
        atoms: [],
      })),
    );

    return {};
  },
});

function redLines(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');

  if (!context) throw new Error('Missing software canvas');
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  const lines: { top: number; bottom: number; left: number }[] = [];

  for (let y = 0; y < height; y++) {
    let left = -1;

    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;

      if (data[index] === 255 && data[index + 1] === 0 && data[index + 2] === 0) {
        left = x;
        break;
      }
    }

    if (left < 0) continue;
    const previous = lines.at(-1);

    if (previous && previous.bottom === y) previous.bottom = y + 1;
    else lines.push({ top: y, bottom: y + 1, left });
  }

  return lines;
}

test('a contributed underline paints wrapped marks in a custom text field and follows history', async ({
  onTestFinished,
}) => {
  const body = 'Several marked words wrap into lines. '.repeat(5);

  const editor = createEditor({
    schema: createSchema({
      extensions: [
        ...starterExtensions,
        imageView,
        starterInput,
        tableView,
        starterPresentation,
        containerDecorations,
        underlineView.configure({ color: '#ff0000', thickness: 2 }),
        caption,
        captionView,
      ],
    }),
    selection: textSelection(1, 0),
    content: [
      {
        kind: 'quote',
        id: 10,
        children: [
          {
            kind: 'caption',
            id: 1,
            body,
            styles: [{ from: 0, to: body.length, mark: { type: 'underline', attrs: null } }],
          },
        ],
      },
    ],
  });

  const host = document.createElement('div');
  host.style.cssText = 'width:340px;height:600px;margin-left:17px;';
  document.body.append(host);
  const view = mountEditor(host, { editor });
  onTestFinished(() => {
    view.destroy();
    editor.destroy();
    host.remove();
  });
  await view.ready;
  const canvas = host.querySelector('canvas');

  if (!canvas) throw new Error('Missing canvas');
  await expect.poll(() => redLines(canvas).length).toBeGreaterThan(2);
  const lines = redLines(canvas);
  const point = view.coordsAt({ id: 1, offset: 0 });

  if (!point) throw new Error('Missing caret');
  expect(lines[0].left).toBeCloseTo(
    (point.left - canvas.getBoundingClientRect().left) * devicePixelRatio,
    0,
  );

  for (const line of lines) expect(line.bottom - line.top).toBeCloseTo(2 * devicePixelRatio, 0);

  for (let index = 1; index < lines.length; index++)
    expect(lines[index].top - lines[index - 1].top).toBeCloseTo(28 * devicePixelRatio, 0);
  editor.select(textSelection(1, body.length, 0));
  editor.transact((draft) => draft.command(formattingCommands.toggleFormat, 'underline'));
  await expect.poll(() => redLines(canvas).length).toBe(0);
  editor.transact((draft) => draft.restoreHistory('undo'));
  await expect.poll(() => redLines(canvas)).toEqual(lines);
  expect(view.status).toBe('ready');
});
