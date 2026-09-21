import { expect, test } from 'vitest';
import { z } from 'zod';

import { createEditor } from '../../core';
import { createSchema, defineNode } from '../../model';
import { composeParagraph } from '../../owned-paragraph';
import { selectionContext, TextSelection, textSelection } from '../../state';
import { createCanvasInput } from '../canvas-input';

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

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function fixture() {
  const editor = createEditor({
    schema,
    content: [
      { kind: 'note', id: 1, text: 'abcdefghij' },
      { kind: 'note', id: 2, text: 'klmnopqrst' },
    ],
  });

  const controller = createCanvasInput({ schema, editor });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:10px;top:10px;width:200px;height:100px;overflow:auto;';
  const space = document.createElement('div');
  space.style.height = '600px';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:sticky;top:0;width:200px;height:100px;display:block;';
  const input = document.createElement('textarea');
  input.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;';
  space.append(canvas);
  host.append(space, input);
  document.body.append(host);
  const scrolls: number[] = [];

  function frame() {
    const nodes = editor.state.nodes;

    const placements = nodes.map((node, index) => ({
      node,
      y: index * 160,
      height: 40,
      layout: composeParagraph(
        {
          clusters: Array.from(node.text, (_, start) => ({
            start,
            end: start + 1,
            width: 10,
            glyphs: [],
            stops: [start + 1],
          })),
          breaks: new Set<number>(),
        },
        node.text.length,
        50,
        20,
        15,
      ),
    }));

    const selection = editor.state.selection;

    const active =
      selection instanceof TextSelection
        ? placements.find((p) => p.node.id === selection.head.id)
        : undefined;

    return {
      context: selectionContext(schema, nodes),
      inset: 5,
      selection,
      nodes,
      node: (id: number) => nodes.find((node) => node.id === id),
      placements,
      layout(id: number) {
        const placement = placements.find((value) => value.node.id === id);

        if (!placement) throw new Error('Missing layout');

        return placement.layout;
      },
      caret:
        active && selection instanceof TextSelection
          ? active.layout.geometry(selection.head.offset, selection.head.offset, false).caret
          : undefined,
      activeTop: active?.y,
      viewport: {
        zoom: 1,
        viewportHeight: 100,
        readScroll: () => host.scrollTop,
        scrollDocumentTo: (top: number) => {
          host.scrollTop = top;
          scrolls.push(host.scrollTop);
        },
      },
    };
  }

  const detach = controller.attach(canvas, input);
  controller.update(frame());

  return {
    editor,
    controller,
    host,
    canvas,
    input,
    scrolls,
    frame,
    detach,
    destroy() {
      controller.destroy();
      host.remove();
      editor.destroy();
    },
  };
}

test('vanilla input binds current line geometry, cross-node selection and hidden textarea positioning', () => {
  const f = fixture();

  try {
    const bounds = f.canvas.getBoundingClientRect();
    expect(f.input.value).toBe('abcdefghij');
    expect(Number.parseFloat(f.input.style.left)).toBe(bounds.left + 5);
    const hit = f.controller.pointerSelection.hitTest(bounds.left + 25, bounds.top + 28);
    expect(hit?.point).toEqual({ id: 1, offset: 7 });
    f.controller.navigate(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true }));
    expect(f.editor.state.selection).toMatchObject({
      anchor: { id: 1, offset: 0 },
      head: { id: 1, offset: 5 },
    });
    f.controller.update(f.frame());
    f.controller.selectAll();
    expect(f.editor.state.selection).toMatchObject({
      anchor: { id: 1, offset: 0 },
      head: { id: 2, offset: 10 },
    });
    f.controller.update(f.frame());
    expect(f.input.value).toBe('');
    expect(document.activeElement).toBe(f.input);
  } finally {
    f.destroy();
  }
});

test('reveal requests wait for matching geometry and also work without a session update', async () => {
  const f = fixture();

  try {
    f.editor.select(textSelection(2, 7));
    f.controller.revealSelection();
    await nextFrame();
    expect(f.host.scrollTop).toBe(0); // The old frame must not consume the request.
    f.controller.update(f.frame());
    expect(f.host.scrollTop).toBe(108);
    expect(f.scrolls).toEqual([108]);
    f.host.scrollTop = 0;
    f.controller.revealSelection();
    await nextFrame();
    expect(f.host.scrollTop).toBe(108);
  } finally {
    f.destroy();
  }
});

test('input detach cancels composition work and stale cleanup leaves a new attachment live', async () => {
  const f = fixture();

  try {
    f.controller.textInput.compositionStart();
    f.input.value = 'Uncommitted composition';
    f.controller.update(f.frame());
    expect(f.input.value).toBe('Uncommitted composition');
    f.controller.textInput.compositionEnd(f.input);
    f.detach();
    await nextFrame();
    expect(f.input.value).toBe('Uncommitted composition');
    const replacement = document.createElement('textarea');
    f.host.append(replacement);
    const detachReplacement = f.controller.attach(f.canvas, replacement);
    f.controller.update(f.frame());
    f.detach();
    replacement.setSelectionRange(0, replacement.value.length);
    replacement.dispatchEvent(new Event('select'));
    expect(f.editor.state.selection).toMatchObject({
      anchor: { id: 1, offset: 0 },
      head: { id: 2, offset: 10 },
    });
    detachReplacement();
  } finally {
    f.destroy();
  }
});

test('terminal input destruction cancels reveal and composition and rejects stale callbacks', async () => {
  const f = fixture();

  try {
    f.controller.textInput.compositionStart();
    f.controller.textInput.compositionEnd(f.input);
    f.input.value = 'Keep this detached value';
    f.editor.select(textSelection(2, 7));
    f.controller.update(f.frame());
    f.input.value = 'Keep this detached value';
    f.controller.revealSelection();
    f.controller.destroy();
    f.controller.destroy();
    f.detach();
    await nextFrame();
    expect(f.host.scrollTop).toBe(0);
    expect(f.input.value).toBe('Keep this detached value');
    expect(() => f.controller.revealSelection()).toThrow(/destroyed/);
    expect(() => f.controller.attach(f.canvas, f.input)).toThrow(/destroyed/);
    expect(() => f.controller.update(f.frame())).toThrow(/destroyed/);
    expect(() => f.controller.textInput.compositionEnd(f.input)).toThrow(/destroyed/);
    expect(() => f.controller.textInput.sync(f.input)).toThrow(/destroyed/);
    expect(f.editor.isDestroyed).toBe(false);
  } finally {
    f.destroy();
  }
});
