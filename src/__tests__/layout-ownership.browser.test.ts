import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm';
import { beforeAll, expect, test } from 'vitest';

import { createEditorScene } from '../editor-canvas/scene';
import type { TextBlockNode } from '../extensions/demo-model';
import { createStarterPresentation } from '../extensions/starter-kit/presentation';
import { createOwnedEngine } from '../owned-layout';

let kit: CanvasKit;

beforeAll(async () => {
  kit = await CanvasKitInit({ locateFile: () => '/engines/canvaskit.wasm' });
});

function paragraph(text: string): TextBlockNode {
  return { kind: 'paragraph', id: 1, key: 'paragraph-1', text, marks: [], inline: [] };
}

const firstInput = {
  id: 1,
  text: 'First owner has its own paragraph.',
  spans: [],
  width: 250,
  size: 20,
};

const secondInput = { ...firstInput, text: 'A different document uses the same local ID.' };

test('layout owners isolate shaping, composition eviction and destruction for identical local IDs', async () => {
  const resources = await createOwnedEngine(kit, 'shaping');
  const first = resources.createLayout();
  const second = resources.createLayout();
  const surface = kit.MakeSurface(400, 200);

  if (!surface) throw new Error('Expected surface');

  try {
    const retained = first.layout(firstInput);
    const originalGeometry = structuredClone(retained.geometry(0, 10, false));
    second.layout(secondInput);
    expect(resources.retention()).toMatchObject({ owners: 2, documents: 2 });
    const glyphCalls = resources.stats.glyphCalls;
    first.layout(firstInput);
    second.layout(secondInput);
    expect(resources.stats.glyphCalls).toBe(glyphCalls);
    const composed = resources.stats.compositions;
    first.releaseLayout(1);
    second.layout(secondInput);
    expect(resources.stats.compositions).toBe(composed);
    first.clear();
    second.layout({ ...secondInput, width: 180 });
    expect(resources.stats.glyphCalls).toBe(glyphCalls);
    expect(resources.retention()).toMatchObject({ owners: 2, documents: 1 });
    first.destroy();
    first.destroy();
    expect(resources.retention()).toMatchObject({ owners: 1, documents: 1 });
    expect(() => first.layout(firstInput)).toThrow(/destroyed/);
    expect(() => first.release(1)).toThrow(/destroyed/);
    expect(retained.geometry(0, 10, false)).toEqual(originalGeometry);
    expect(() => retained.draw(surface.getCanvas(), 0, 0)).not.toThrow();
    second.layout(secondInput);
    expect(resources.stats.glyphCalls).toBe(glyphCalls);
  } finally {
    resources.destroy();
    surface.delete();
  }
});

test('scene replacement drops only its own caches and labels retain no reserved document ID', async () => {
  const resources = await createOwnedEngine(kit, 'shaping');
  const first = createEditorScene(resources, createStarterPresentation(20));
  const second = createEditorScene(resources, createStarterPresentation(20));

  const view = {
    top: 0,
    height: 400,
    zoom: 1,
    pinned: [],
    advance: true,
    eager: true,
    retainAll: true,
  };

  const firstNodes = [paragraph(firstInput.text)];
  const secondNodes = [paragraph(secondInput.text)];

  try {
    first.build(firstNodes, 250, new Map(), view);
    second.build(secondNodes, 250, new Map(), view);
    expect(resources.retention()).toMatchObject({ owners: 2, documents: 2 });
    const calls = resources.stats.glyphCalls;
    first.clear();
    expect(resources.retention()).toMatchObject({ owners: 1, documents: 1 });
    second.build(secondNodes, 180, new Map(), view);
    expect(resources.stats.glyphCalls).toBe(calls);
    first.build(firstNodes, 300, new Map(), view);
    expect(resources.retention()).toMatchObject({ owners: 2, documents: 2 });
    resources.layoutText({ text: 'Mention label', width: 120, size: 18, spans: [] });
    expect(resources.retention()).toMatchObject({ owners: 2, documents: 2 });
    first.clear();
    second.clear();
    expect(resources.retention()).toEqual({ owners: 0, documents: 0, paragraphVariants: 0 });
  } finally {
    resources.destroy();
  }
});

test('resource destruction releases all owners and prevents native drawing or shaping from stale handles', async () => {
  const resources = await createOwnedEngine(kit, 'shaping');
  const owner = resources.createLayout();
  const snapshot = owner.layout(firstInput);

  const inline = owner.layoutInline({
    ...firstInput,
    id: 2,
    text: '\ufffc',
    atoms: [{ id: 'mention', index: 0, label: 'Mention', width: 60, ascent: 20, descent: 5 }],
  });

  const blockDocument = resources.createBlockDocument({ width: 250, size: 20 });
  blockDocument.splice(0, 0, [{ text: 'Separate block document', spans: [] }]);
  const surface = kit.MakeSurface(400, 200);

  if (!surface) throw new Error('Expected surface');

  try {
    snapshot.draw(surface.getCanvas(), 0, 0);
    expect(resources.memory().wasmLinearBytes).toBeGreaterThan(0);
    resources.destroy();
    resources.destroy();
    expect(resources.memory()).toMatchObject({
      wasmLinearBytes: 0,
      paragraphs: 0,
      composedParagraphs: 0,
    });
    expect(resources.retention()).toEqual({ owners: 0, documents: 0, paragraphVariants: 0 });
    expect(() => owner.layout(firstInput)).toThrow(/destroyed/);
    expect(() => resources.createLayout()).toThrow(/destroyed/);
    expect(() => resources.layoutText(firstInput)).toThrow(/destroyed/);
    expect(() => resources.createBlockDocument({ width: 250, size: 20 })).toThrow(/destroyed/);
    expect(() => blockDocument.snapshot()).toThrow(/released/);
    expect(() => snapshot.draw(surface.getCanvas(), 0, 0)).toThrow(/destroyed/);
    expect(() => inline.draw(surface.getCanvas(), 0, 0)).toThrow(/destroyed/);
    expect(snapshot.geometry(0, 0, false).caret.every(Number.isFinite)).toBe(true);
    owner.destroy();
  } finally {
    resources.destroy();
    surface.delete();
  }
});
