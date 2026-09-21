import { expect, test } from 'vitest';

import { createEditor } from '../../../core';
import { defineStyleRule, mountEditor } from '../../../editor-canvas';
import { createViewDiagnostics } from '../../../editor-canvas/diagnostics';
import { createSchema } from '../../../model';
import { paragraph, heading } from '../../starter-definitions';
import { starterBrowserExtensions } from '../browser';

test('list markers follow their text metrics, font and live theme rather than independent CSS constants', async ({
  onTestFinished,
}) => {
  const editor = createEditor({
    schema: createSchema({ extensions: starterBrowserExtensions() }),
    content: [
      {
        kind: 'list',
        ordered: true,
        start: 3,
        children: [
          {
            kind: 'listItem',
            children: [
              {
                kind: 'paragraph',
                id: 10,
                text: 'First item',
                marks: [{ from: 0, to: 10, mark: { type: 'underline', attrs: null } }],
              },
            ],
          },
          {
            kind: 'listItem',
            children: [{ kind: 'heading', id: 20, level: 2, text: 'Second item' }],
          },
        ],
      },
    ],
  });

  const host = document.createElement('div');
  host.style.cssText = 'width:600px;height:350px;';
  document.body.append(host);
  const diagnostics = createViewDiagnostics();
  const view = mountEditor(host, { editor, diagnostics });
  onTestFinished(() => {
    view.destroy();
    editor.destroy();
    host.remove();
  });
  await view.ready;
  const first = host.querySelector('[data-block-decoration="10"] .list-marker');
  const second = host.querySelector('[data-block-decoration="20"] .list-marker');

  if (!first || !second) throw new Error('Missing list markers');
  expect(first.textContent).toBe('3.');
  expect(second.textContent).toBe('4.');
  expect(getComputedStyle(first).fontSize).toBe('18px');
  expect(getComputedStyle(second).fontSize).toBe('28px');
  const baseline = document.createElement('span');
  baseline.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;';
  first.append(baseline);
  const line = diagnostics.inspectText({ id: 10, range: { from: 0, to: 2 } })?.lines[0];

  if (!line) throw new Error('Missing text line');
  expect(baseline.getBoundingClientRect().top).toBeCloseTo(
    view.blockBounds(10, 'client')!.top + line.baseline,
    0,
  );
  view.update({
    theme: {
      baselineGrid: 0,
      rules: [
        defineStyleRule(paragraph, { size: 24, lineHeight: 40, color: 'blue' }),
        defineStyleRule(heading, { size: 32, lineHeight: 48, font: { weight: 400 } }),
      ],
    },
  });
  expect(getComputedStyle(first).fontSize).toBe('24px');
  expect(getComputedStyle(first).color).toBe('rgb(0, 0, 255)');
  expect(getComputedStyle(first).lineHeight).toBe('40px');
  expect(getComputedStyle(second).fontSize).toBe('32px');
  expect(getComputedStyle(second).fontWeight).toBe('400');
  expect(first.getBoundingClientRect().top).toBeCloseTo(view.blockBounds(10, 'client')!.top, 0);
  expect(view.coordsAt({ id: 10, offset: 2 })?.height).toBe(40);
  first.append(baseline);
  const changedLine = diagnostics.inspectText({ id: 10, range: { from: 0, to: 2 } })?.lines[0];

  if (!changedLine) throw new Error('Missing updated text line');
  expect(baseline.getBoundingClientRect().top).toBeCloseTo(
    view.blockBounds(10, 'client')!.top + changedLine.baseline,
    0,
  );
  const canvas = host.querySelector('canvas');
  const caret = view.coordsAt({ id: 10, offset: 0 });

  if (!canvas || !caret) throw new Error('Missing painted editor');
  const surface = canvas.getContext('2d');

  if (!surface) throw new Error('Missing editor pixel context');
  const bounds = canvas.getBoundingClientRect();
  const scale = canvas.width / bounds.width;
  const x = Math.floor((caret.left - bounds.left + 10) * scale);
  const y = Math.floor((caret.top - bounds.top + changedLine.baseline + 2.5) * scale);
  await expect
    .poll(() => {
      const [r, g, b] = surface.getImageData(x, y, 1, 1).data;

      return b > r + 100 && b > g + 100;
    })
    .toBe(true);
});
