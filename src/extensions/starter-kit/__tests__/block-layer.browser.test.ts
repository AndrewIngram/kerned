import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm';
import { createElement, StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, test } from 'vitest';

import { createEditor } from '../../../core';
import { createTextInput } from '../../../editor-browser';
import { createCanvasRenderer } from '../../../editor-canvas/canvas-renderer';
import {
  createDocumentLayout,
  type DocumentLayoutFrame,
} from '../../../editor-canvas/document-layout';
import { CanvasLayerProvider } from '../../../editor-react';
import { createSchema } from '../../../model';
import { createOwnedEngine } from '../../../owned-layout';
import { createFind, textSelection } from '../../../state';
import { createCommentStore } from '../../comment';
import { commentView, onCommentActivate } from '../../comment-view';
import { createSampleDocument, type StarterNode } from '../../demo-model';
import { BlockLayer } from '../block-layer';
import { starterBrowserExtensions, onMentionActivate } from '../browser';
import { createStarterDocumentQuery } from '../browser-document';
import { createStarterKitInput } from '../input';
import { createBlockLayer, type BlockLayerFrame } from '../native-block-layer';
import { createStarterPresentation } from '../presentation';

let kit: CanvasKit;

beforeAll(async () => {
  kit = await CanvasKitInit({ locateFile: () => '/engines/canvaskit.wasm' });
});

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function fixture() {
  const owned = await createOwnedEngine(kit, 'shaping');

  const comments = createCommentStore<string>();

  const editor = createEditor({
    schema: createSchema({
      extensions: [commentView(comments), ...starterBrowserExtensions({ imageDelay: 80 })],
    }),
    document: createSampleDocument().slice(0, 4),
  });

  comments.put({
    id: 'discussion',
    messages: ['Comment'],
    range: editor.positions.range(editor.positions.at(2, 0, 1), editor.positions.at(2, 9, -1)),
  });
  const project = createStarterDocumentQuery(editor.schema);
  const root = document.createElement('div');
  root.style.cssText = 'position:relative;width:500px;height:700px;';
  const canvas = document.createElement('canvas');
  const host = document.createElement('div');
  root.append(canvas, host);
  document.body.append(root);
  const renderer = createCanvasRenderer<StarterNode>();
  renderer.attach(kit, canvas);
  const layer = createBlockLayer(host, { editor, owned, register: renderer.register });

  const layout = createDocumentLayout({
    owned,
    present: createStarterPresentation(20),
    source: { getSnapshot: () => project(editor.state), subscribe: editor.subscribe },
  });

  const capture = document.createElement('textarea');
  const textInput = createTextInput(editor.schema, editor);

  const input = createStarterKitInput({
    editor,
    textInput,
    input: () => capture,
    onEdit() {},
    notice() {},
    closePanel() {},
    escape() {},
    selectAll: () => editor.commands.selectAll(),
    navigate: () => false,
  });

  const find = createFind(editor.schema, () => editor.state.nodes);

  const opened: {
    kind: string;
    node: number;
    id: string;
    index: number;
    focus?: 'text' | 'panel';
  }[] = [];

  onMentionActivate(editor, ({ nodeId, id, index }) =>
    opened.push({ kind: 'mention', node: nodeId, id, index }),
  );
  onCommentActivate(editor, ({ nodeId, id, index, focus }) =>
    opened.push({ kind: 'comment', node: nodeId, id, index, focus }),
  );
  const focused: (number | null)[] = [];
  let visible: Set<number> | undefined;

  const layoutFrame: DocumentLayoutFrame = {
    viewport: {
      width: 500,
      zoom: 1,
      viewportHeight: 700,
      readScroll: () => 0,
      scrollDocumentTo: () => {},
    },
    pinned: [],
    paddingTop: 0,
    eager: true,
    retainAll: false,
    onLayout: () => {},
  };

  function frame(): BlockLayerFrame {
    const snapshot = layout.getSnapshot();

    return {
      doc: project(editor.state),
      clipboard: input.events,
      layout: {
        ...snapshot,
        visible: snapshot.visible.filter((p) => !visible || visible.has(p.node.id)),
        onMeasure: layout.measure,
      },
      viewport: { width: 500, zoom: 1 },
      highlights: new Map(
        [...find.state.byNode].map(([id, matches]) => [
          id,
          matches.map((match) => ({ ...match, active: false })),
        ]),
      ),
      notice() {},
      setFocusedWidget: (id) => focused.push(id),
    };
  }

  function paint() {
    const value = frame();
    layer.update(value);
    renderer.update({
      inset: value.layout.inset,
      width: 500,
      height: 700,
      zoom: 1,
      top: 0,
      background: [255, 255, 255],
      blocks: [],
      selectedRange: () => null,
      highlights: [],
      caret: undefined,
      caretTop: 0,
      focused: false,
      onPaint: () => {},
    });
  }

  function refresh() {
    layout.update(layoutFrame);
    paint();
  }

  const stopLayout = layout.subscribe(paint);
  layout.attach();
  const stopEditor = editor.subscribe(refresh);
  refresh();

  return {
    editor,
    owned,
    host,
    canvas,
    layer,
    layout,
    renderer,
    opened,
    focused,
    frame,
    refresh,
    show(ids?: number[]) {
      visible = ids ? new Set(ids) : undefined;
      paint();
    },
    detachRendering() {
      stopEditor();
      stopLayout();
      layer.destroy();
    },
    destroy() {
      stopEditor();
      stopLayout();
      layer.destroy();
      textInput.destroy();
      layout.destroy();
      renderer.destroy();
      editor.destroy();
      owned.destroy();
      root.remove();
    },
  };
}

function button(root: HTMLElement, selector: string) {
  const value = root.querySelector<HTMLButtonElement>(selector);

  if (!value) throw new Error(`Missing button: ${selector}`);

  return value;
}

test('native block layer paints and positions comments and mentions, preserves label caches across culling, and owns cleanup', async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(() => f.destroy());
  const mention = button(f.host, '[data-mention]');
  const comment = button(f.host, '[data-decoration="2"]');
  mention.click();
  expect(f.opened.at(-1)).toMatchObject({ kind: 'mention', node: 1, id: 'maya' });
  comment.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  expect(f.opened).toHaveLength(1);
  comment.click();
  expect(f.opened.at(-1)).toMatchObject({
    kind: 'comment',
    node: 2,
    id: 'discussion',
    focus: 'panel',
  });
  expect(comment.hasAttribute('data-editor-text-hit')).toBe(true);
  const placement = f.frame().layout.visible.find((p) => p.node.id === 1);

  if (!placement) throw new Error('Missing first paragraph');
  expect(parseFloat(mention.style.left)).toBeCloseTo(28 + placement.boxes[0].x);
  expect(parseFloat(mention.style.top)).toBeCloseTo(placement.y + placement.boxes[0].y);
  await nextFrame();
  const context = f.canvas.getContext('2d');

  if (!context) throw new Error('Missing canvas context');
  const scale = devicePixelRatio;
  expect([
    ...context.getImageData(
      Math.floor((parseFloat(comment.style.left) + 2) * scale),
      Math.floor((parseFloat(comment.style.top) + 2) * scale),
      1,
      1,
    ).data,
  ]).toEqual([246, 234, 180, 255]);
  const glyphs = f.owned.stats.glyphCalls;
  expect(f.renderer.diagnostics.painterCount).toBe(3);
  f.show([3, 4]);
  expect(f.renderer.diagnostics.painterCount).toBe(0);
  expect(f.host.querySelector('[data-mention]')).toBeNull();
  f.show();
  expect(f.owned.stats.glyphCalls).toBe(glyphs);
  expect(f.renderer.diagnostics.painterCount).toBe(3);
  f.editor.destroy();
  expect(f.layer.isDestroyed).toBe(true);
  expect(f.renderer.diagnostics.painterCount).toBe(0);
  expect(f.host.children).toHaveLength(0);
  mention.click();
  expect(f.opened).toHaveLength(2);
});

test('native block layer edits table content, reports native focus and renders structural decorations', async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(() => f.destroy());
  const table = f.host.querySelector<HTMLElement>('[data-table]');

  if (!table) throw new Error('Missing table');
  // WebKit may focus the table ancestor when a native button is clicked.
  table.focus();
  button(f.host, '[aria-label="Edit cell 1, 1"]').click();
  const input = f.host.querySelector('textarea');

  if (!input) throw new Error('Missing table input');
  expect(document.activeElement).toBe(input);
  expect(f.focused.at(-1)).toBe(3);
  input.value = 'Native layer edit';
  input.setSelectionRange(input.value.length, input.value.length);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'Native layer edit' }));
  expect(f.host.querySelector('textarea')).toBe(input);
  expect(f.frame().doc.tree.byId.get(20002)?.node).toMatchObject({ text: 'Native layer edit' });
  f.editor.select(textSelection(1, 0));
  f.editor.commands.toggleQuote();
  expect(f.host.querySelector('[data-quote]')).not.toBeNull();
  f.editor.commands.undo();
  expect(f.host.querySelector('[data-quote]')).toBeNull();
  f.editor.commands.undo();
  expect(f.frame().doc.tree.byId.get(20002)?.node).toMatchObject({
    text: 'Keep the first release focused.',
  });
  f.show([1, 2, 4]);
  expect(f.host.querySelector('[data-table]')).toBeNull();
  f.show();
  expect(f.host.querySelector('[data-table]')).not.toBeNull();
});

test('React strict remounts attach the native block layer without retaining painters or reviving a destroyed session', async ({
  onTestFinished,
}) => {
  const f = await fixture();
  f.detachRendering();
  const frame = f.frame();
  const root = createRoot(f.host);
  onTestFinished(() => {
    flushSync(() => root.unmount());
    f.destroy();
  });

  function render(key: string) {
    flushSync(() =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            CanvasLayerProvider,
            { value: f.renderer.register },
            createElement(BlockLayer, {
              onTextPointer: () => () => {},
              ...frame,
              key,
              editor: f.editor,
              owned: f.owned,
            }),
          ),
        ),
      ),
    );
  }

  render('first');
  expect(f.renderer.diagnostics.painterCount).toBe(3);
  expect(f.host.querySelectorAll('[data-mention]')).toHaveLength(1);
  render('second');
  expect(f.renderer.diagnostics.painterCount).toBe(3);
  expect(f.host.querySelectorAll('[data-mention]')).toHaveLength(1);
  f.editor.destroy();
  expect(f.renderer.diagnostics.painterCount).toBe(0);
  expect(f.host.querySelector('[data-mention]')).toBeNull();
  render('second');
  render('third');
  expect(f.renderer.diagnostics.painterCount).toBe(0);
  expect(f.host.querySelector('[data-mention]')).toBeNull();
});
