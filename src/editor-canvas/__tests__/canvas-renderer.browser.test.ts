import CanvasKitInit, { type CanvasKit, type Paint } from 'canvaskit-wasm';
import { beforeAll, expect, test } from 'vitest';

import type { Drawing } from '../../editor-browser/drawing';
import { createCanvasRenderer, type CanvasFrame } from '../canvas-renderer';
import { createLayerDrawing } from '../layer-drawing';

let kit: CanvasKit;

beforeAll(async () => {
  kit = await CanvasKitInit({ locateFile: () => '/engines/canvaskit.wasm' });
});

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function frame(onPaint: () => void): CanvasFrame<never> {
  return {
    inset: 0,
    width: 80,
    height: 40,
    zoom: 1,
    top: 0,
    background: [255, 255, 255],
    blocks: [],
    selectedRange: () => null,
    highlights: [],
    caret: undefined,
    caretTop: 0,
    focused: false,
    onPaint,
  };
}

function pixel(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');

  if (!context) throw new Error('Expected software canvas');

  return [...context.getImageData(2, 2, 1, 1).data];
}

test('extension drawing uses document coordinates, restores transforms and expires outside paint', async ({
  onTestFinished,
}) => {
  const canvas = document.createElement('canvas');
  const renderer = createCanvasRenderer<never>();
  onTestFinished(() => renderer.destroy());
  const drawing = createLayerDrawing(renderer.register, () => 12);
  const borrowed: Drawing[] = [];
  drawing('extension', 'content', (paint) => {
    borrowed.push(paint);
    paint.rect({ left: 20, top: 12, width: 10, height: 8 }, '#ff0000', 2);
  });
  renderer.register(
    'following',
    (target, graphics, paint) => {
      paint.setColor(graphics.Color(0, 0, 255));
      target.drawRect(graphics.XYWHRect(0, 20, 4, 4), paint);
    },
    'content',
  );
  renderer.attach(kit, canvas);
  renderer.update({ ...frame(() => {}), inset: 12, top: 10, zoom: 1.5 });
  await nextFrame();
  const context = canvas.getContext('2d');

  if (!context) throw new Error('Missing canvas');
  const scale = 1.5 * devicePixelRatio;

  const at = (x: number, y: number) => [
    ...context.getImageData(Math.floor(x * scale), Math.floor((y - 10) * scale), 1, 1).data,
  ];

  expect(at(25, 16)).toEqual([255, 0, 0, 255]);
  expect(at(13, 21)).toEqual([0, 0, 255, 255]);
  expect(() => borrowed[0].rect({ left: 0, top: 0, width: 1, height: 1 }, 'red')).toThrow(
    'only available during',
  );
});

test('vanilla renderer coalesces updates, paints pixels and isolates replacement registrations', async () => {
  const canvas = document.createElement('canvas');
  const renderer = createCanvasRenderer<never>();
  const reports: string[] = [];
  const paints: Paint[] = [];

  const first = renderer.register(
    'block',
    (target, graphics, paint) => {
      paint.setColor(graphics.Color(255, 0, 0));
      target.drawRect(graphics.XYWHRect(0, 0, 20, 20), paint);
    },
    'content',
  );

  const replacement = renderer.register(
    'block',
    (target, graphics, paint) => {
      paints.push(paint);
      paint.setColor(graphics.Color(0, 128, 0));
      target.drawRect(graphics.XYWHRect(0, 0, 20, 20), paint);
    },
    'content',
  );

  first();
  expect(renderer.diagnostics.painterCount).toBe(1);
  const detach = renderer.attach(kit, canvas);
  renderer.update(frame(() => reports.push('discarded')));
  renderer.update(frame(() => reports.push('latest')));
  await nextFrame();
  expect(reports).toEqual(['latest']);
  expect(pixel(canvas)).toEqual([0, 128, 0, 255]);
  expect(paints[0].isDeleted()).toBe(false);
  renderer.update({ ...frame(() => reports.push('resized')), width: 100 });
  expect(paints[0].isDeleted()).toBe(true);
  await nextFrame();
  expect(canvas.width).toBe(Math.round(100 * window.devicePixelRatio));
  expect(pixel(canvas)).toEqual([0, 128, 0, 255]);
  detach();
  expect(paints[1].isDeleted()).toBe(true);
  const otherCanvas = document.createElement('canvas');
  const detachOther = renderer.attach(kit, otherCanvas);
  detach(); // A stale attachment cleanup must not detach its successor.
  renderer.update(frame(() => reports.push('reattached')));
  await nextFrame();
  expect(pixel(otherCanvas)).toEqual([0, 128, 0, 255]);
  expect(paints[2].isDeleted()).toBe(false);
  replacement();
  expect(renderer.diagnostics.painterCount).toBe(0);
  detachOther();
  expect(paints[2].isDeleted()).toBe(true);
  renderer.destroy();
});

test('destroy cancels queued work, frees native paints and rejects revival', async () => {
  const renderer = createCanvasRenderer<never>();
  const canvas = document.createElement('canvas');
  const paints: Paint[] = [];
  let reports = 0;
  renderer.attach(kit, canvas);

  const remove = renderer.register(
    'capture',
    (_canvas, _kit, paint) => {
      paints.push(paint);
    },
    'content',
  );

  renderer.update(
    frame(() => {
      reports++;
    }),
  );
  await nextFrame();
  expect(reports).toBe(1);
  renderer.update(
    frame(() => {
      reports++;
    }),
  );
  renderer.destroy();
  renderer.destroy();
  remove();
  expect(paints[0].isDeleted()).toBe(true);
  expect(renderer.diagnostics.painterCount).toBe(0);
  await nextFrame();
  expect(reports).toBe(1);
  expect(() => renderer.attach(kit, canvas)).toThrow(/destroyed/);
  expect(() => renderer.update(frame(() => {}))).toThrow(/destroyed/);
  expect(() => renderer.register('late', () => {}, 'content')).toThrow(/destroyed/);
});

test('destruction inside a painter retires resources after the active draw unwinds', async () => {
  const renderer = createCanvasRenderer<never>();
  const paints: Paint[] = [];
  let reports = 0;
  renderer.attach(kit, document.createElement('canvas'));
  renderer.register(
    'destroy',
    (_canvas, _kit, paint) => {
      paints.push(paint);
      renderer.destroy();
      expect(paint.isDeleted()).toBe(false);
    },
    'background',
  );
  renderer.update(
    frame(() => {
      reports++;
    }),
  );
  await nextFrame();
  expect(paints).toHaveLength(1);
  expect(paints[0].isDeleted()).toBe(true);
  expect(reports).toBe(0);
});
