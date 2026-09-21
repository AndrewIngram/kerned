import { expect, test } from 'vitest';

import { createEditor } from '../src/core';
import { defaultFonts, defineStyleRule, mountEditor } from '../src/editor-canvas';
import { createViewDiagnostics } from '../src/editor-canvas/diagnostics';
import { importHtml } from '../src/extensions/html';
import { heading, paragraph } from '../src/extensions/starter-definitions';
import { starterBrowserExtensions } from '../src/extensions/starter-kit/browser';
import { createSchema } from '../src/model';
import { textSelection } from '../src/state';

test('Warbreaker retains its distant caret and reading anchor through live metrics, colors and font sources', async ({
  onTestFinished,
}) => {
  const response = await fetch('/samples/warbreaker.html');
  expect(response.ok).toBe(true);
  const { nodes } = importHtml(await response.text());
  expect(nodes.length).toBeGreaterThan(7000);
  const schema = createSchema({ extensions: starterBrowserExtensions() });
  const editor = createEditor({ schema, document: nodes });
  const host = document.createElement('div');
  host.style.cssText = 'width:800px;height:500px;';
  document.body.append(host);
  onTestFinished(() => {
    editor.destroy();
    host.remove();
  });
  const diagnostics = createViewDiagnostics();
  let stalePaints = 0;
  diagnostics.subscribe((event) => {
    if (event.type === 'paint' && event.stale) stalePaints++;
  });
  const view = mountEditor(host, { editor, diagnostics });
  await view.ready;
  await expect.poll(() => diagnostics.read()?.pending, { timeout: 15000 }).toBe(0);

  const target = nodes
    .slice(Math.floor(nodes.length * 0.7))
    .find((node) => node.kind === 'paragraph' && node.text.length > 100);

  if (!target || target.kind !== 'paragraph') throw new Error('Expected distant book paragraph');
  editor.select(textSelection(target.id, 12));
  await view.reveal({ id: target.id, offset: 12 }, { align: 'start' });
  view.focus();
  const input = host.querySelector('textarea');
  const selection = editor.state.selection;
  const before = view.blockBounds(target.id, 'client');
  view.update({
    theme: {
      baselineGrid: 0,
      rules: [
        defineStyleRule(paragraph, { size: 22, lineHeight: 35, after: 21, font: { weight: 700 } }),
        defineStyleRule(heading, ({ level }) => ({
          size: 42 - level * 4,
          lineHeight: 48 - level * 4,
          font: { weight: 400 },
        })),
      ],
    },
  });
  expect(diagnostics.read()?.pending).toBeGreaterThan(0);
  expect(view.coordsAt({ id: target.id, offset: 12 })?.height).toBe(35);
  expect(editor.state.selection).toBe(selection);
  await expect.poll(() => diagnostics.read()?.pending, { timeout: 15000 }).toBe(0);
  expect(view.blockBounds(target.id, 'client')?.top).toBeCloseTo(before?.top ?? 0, 0);
  expect(view.getSnapshot()?.viewport.top).toBeGreaterThan(10000);
  const metrics = diagnostics.read();
  const caret = view.coordsAt({ id: target.id, offset: 12 });
  view.update({
    theme: {
      baselineGrid: 0,
      rules: [
        defineStyleRule(paragraph, {
          size: 22,
          lineHeight: 35,
          after: 21,
          font: { weight: 700 },
          color: '#245c3c',
        }),
        defineStyleRule(heading, ({ level }) => ({
          size: 42 - level * 4,
          lineHeight: 48 - level * 4,
          font: { weight: 400 },
          color: '#245c3c',
        })),
      ],
    },
  });
  expect(diagnostics.read()?.stats.glyphCalls).toBe(metrics?.stats.glyphCalls);
  expect(diagnostics.read()?.stats.compositions).toBe(metrics?.stats.compositions);
  expect(diagnostics.read()?.generation).toBe(metrics?.generation);
  expect(view.coordsAt({ id: target.id, offset: 12 })).toEqual(caret);
  await view.setFonts({
    ...defaultFonts,
    faces: defaultFonts.faces.map((face, index) =>
      index === 1 ? { ...face, asset: defaultFonts.faces[0].asset } : face,
    ),
  });
  expect(view.coordsAt({ id: target.id, offset: 12 })?.left).not.toBe(caret?.left);
  expect(editor.state.selection).toBe(selection);
  expect(host.querySelector('textarea')).toBe(input);
  expect(document.activeElement).toBe(input);
  await expect.poll(() => diagnostics.read()?.pending, { timeout: 15000 }).toBe(0);
  expect(view.blockBounds(target.id, 'client')?.top).toBeCloseTo(before?.top ?? 0, 0);
  expect(editor.commands.insertText(' live edit ')).toBe(true);
  const edited = editor.state.nodes.find((node) => node.id === target.id);
  expect(edited?.kind === 'paragraph' && edited.text).toBe(
    target.text.slice(0, 12) + ' live edit ' + target.text.slice(12),
  );
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.nodes.find((node) => node.id === target.id)).toEqual(target);
  expect(stalePaints).toBe(0);
}, 30000);
