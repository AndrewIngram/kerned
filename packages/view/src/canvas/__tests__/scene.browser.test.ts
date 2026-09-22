import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm';
import { beforeAll, expect, test } from 'vitest';

import { createOwnedEngine } from '../../internal/owned-layout.js';
import { createEditorScene, type BlockPresentation, type PresentBlock } from '../scene.js';

let kit: CanvasKit;

beforeAll(async () => {
  kit = await CanvasKitInit({ locateFile: () => '/engines/canvaskit.wasm' });
});

type Note = { id: number; key: string; kind: 'note'; body: string; size: number };

type Media = { id: number; key: string; kind: 'media'; estimatedHeight: number };

type Content = Note | Media;

const note = (id: number, body: string, size = 18): Note => ({
  id,
  key: `note-${id}`,
  kind: 'note',
  body,
  size,
});

function presentation(): PresentBlock<Content> {
  const cache = new WeakMap<Content, BlockPresentation>();

  return (node) => {
    const previous = cache.get(node);

    if (previous) return previous;

    const value: BlockPresentation =
      node.kind === 'media'
        ? { kind: 'box', before: 12, after: 18, baselineGrid: 6, height: node.estimatedHeight }
        : {
            kind: 'text',
            text: node.body,
            size: node.size,
            lineHeight: node.size * 2,
            before: 6,
            after: 12,
            baselineGrid: 6,
            spans: node.body.length
              ? [{ start: 0, end: node.body.length, bold: true, italic: false }]
              : [],
            atoms: node.body.includes('\ufffc')
              ? [
                  {
                    id: `token-${node.id}`,
                    index: node.body.indexOf('\ufffc'),
                    label: 'Custom token',
                    width: 80,
                    ascent: 20,
                    descent: 8,
                  },
                ]
              : [],
          };

    cache.set(node, value);

    return value;
  };
}

const viewport = {
  top: 0,
  height: 200,
  zoom: 1,
  pinned: [],
  advance: false,
  eager: true,
  retainAll: true,
};

test('foreign nodes use supplied text, inline metrics, spacing and measured box heights', async ({
  onTestFinished,
}) => {
  const resources = await createOwnedEngine(kit, 'shaping');
  onTestFinished(() => resources.destroy());
  const scene = createEditorScene(resources, presentation());

  const nodes: Content[] = [
    note(1, 'A custom \ufffc followed by text'),
    { id: 2, key: 'media-2', kind: 'media', estimatedHeight: 31 },
    note(3, 'Another note', 24),
  ];

  const initial = scene.build(nodes, 200, new Map(), viewport).scene;
  const [first, media, last] = initial.placements;
  expect(first.node).toBe(nodes[0]);
  expect(first.y).toBe(32);
  expect(first.boxes).toMatchObject([{ id: 'token-1', label: 'Custom token', width: 80 }]);
  expect(media.y).toBe(first.y + first.height + 12);
  expect(media.height).toBe(31);
  expect(last.y).toBe(media.y + 36 + 18);
  expect(last.layout?.lines[0].bottom).toBeGreaterThan(36);

  const measured = scene.build(
    nodes,
    200,
    new Map([[2, { width: 200, height: 43 }]]),
    viewport,
  ).scene;

  expect(measured.placements[1].height).toBe(43);
  expect(measured.placements[2].y).toBe(media.y + 48 + 18);
  expect(initial.placements[1].height).toBe(31);
  expect(initial.placements[2].y).toBe(last.y);
  const wider = scene.build(nodes, 500, new Map([[2, { width: 200, height: 43 }]]), viewport).scene;
  expect(wider.placements[1].height).toBe(31);
  expect(wider.placements[0].height).toBeLessThan(first.height);
});

test('changing only indentation reflows text without changing node identities or stale snapshots', async ({
  onTestFinished,
}) => {
  const resources = await createOwnedEngine(kit, 'shaping');
  onTestFinished(() => resources.destroy());
  const scene = createEditorScene(resources, presentation());
  const nodes = [note(1, 'A paragraph wide enough to wrap as its available width changes.')];
  const measurements = new Map();
  const original = scene.build(nodes, 300, measurements, viewport).scene;
  const oldCaret = original.placements[0].layout?.geometry(0, 0, false).caret;

  const next = scene.build(
    nodes,
    300,
    measurements,
    viewport,
    new Map([[1, { inset: 140 }]]),
  ).scene;

  expect(next.placements[0].height).toBeGreaterThan(original.placements[0].height);
  expect(next.placements[0].layout?.geometry(0, 0, false).caret[0]).toBe(140);
  expect(original.placements[0].layout?.geometry(0, 0, false).caret).toEqual(oldCaret);
  expect(scene.layoutFor(1).geometry(0, 0, false).caret[0]).toBe(140);
});

test('replacing text with a box at the same identity releases its retained layout', async ({
  onTestFinished,
}) => {
  const resources = await createOwnedEngine(kit, 'shaping');
  onTestFinished(() => resources.destroy());
  const scene = createEditorScene(resources, presentation());
  const text = note(1, 'Content changes its presentation kind');
  const original = scene.build([text], 250, new Map(), viewport).scene;
  expect(resources.retention().documents).toBe(1);
  scene.build([{ ...text }], 250, new Map(), viewport);
  const composed = resources.stats.compositions;
  scene.layoutFor(1);
  expect(resources.stats.compositions).toBe(composed);
  const media: Content = { id: 1, key: text.key, kind: 'media', estimatedHeight: 50 };
  const replaced = scene.build([media], 250, new Map(), viewport).scene;
  expect(replaced.placements[0]).toMatchObject({ node: media, height: 50, layout: null });
  expect(scene.cachedParagraphs).toBe(0);
  expect(resources.retention().documents).toBe(0);
  expect(() => scene.layoutFor(1)).toThrow('Missing text layout');
  const restored = scene.build([text], 250, new Map(), viewport).scene;
  expect(restored.placements[0].height).toBe(original.placements[0].height);
  expect(restored.placements[0].layout?.lines).toEqual(original.placements[0].layout?.lines);
  scene.clear();
  expect(resources.retention()).toMatchObject({ owners: 0, documents: 0 });
});

test('foreign text preserves viewport-first loading, latest queued edits and navigation after eviction', async ({
  onTestFinished,
}) => {
  const resources = await createOwnedEngine(kit, 'shaping');
  onTestFinished(() => resources.destroy());
  const describe = presentation();
  const scene = createEditorScene(resources, describe);

  const nodes = Array.from({ length: 800 }, (_, id) =>
    note(id, `Note ${id}. Words to wrap over more than one line.`),
  );

  const view = { ...viewport, eager: false, retainAll: false };
  const measurements = new Map();
  let current = scene.build(nodes, 250, measurements, view).scene;
  expect(current.pending).toBeGreaterThan(0);
  expect(scene.residentParagraphs).toBeLessThan(150);

  const edited = nodes.map((node) =>
    node.id === 700 ? { ...node, body: 'Edited offscreen content '.repeat(8), size: 24 } : node,
  );

  current = scene.build(edited, 180, measurements, view).scene;
  expect(current.placements[700].layout).toBeNull();

  for (let count = 0; current.pending && count < 100; count++) {
    current = scene.build(edited, 180, measurements, { ...view, advance: true }).scene;
  }

  expect(current.pending).toBe(0);

  const eager = createEditorScene(resources, describe).build(
    edited,
    180,
    new Map(),
    viewport,
  ).scene;

  expect(current.placements.map((p) => [p.y, p.height])).toEqual(
    eager.placements.map((p) => [p.y, p.height]),
  );
  expect(current.height).toBe(eager.height);
  const target = current.placements[700];
  expect(target.layout).toBeNull();
  expect(scene.layoutFor(700).lines).toEqual(eager.placements[700].layout?.lines);
  expect(current.placements[700].layout).toBeNull();

  const revealed = scene.build(edited, 180, measurements, {
    ...view,
    top: target.y,
    pinned: [700],
  }).scene;

  expect(revealed.placements[700].layout?.lines).toEqual(eager.placements[700].layout?.lines);
  expect(scene.residentParagraphs).toBeLessThan(150);
});
