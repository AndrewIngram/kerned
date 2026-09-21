import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm';
import { beforeAll, expect, test } from 'vitest';

import { createEditor } from '../../../core';
import { createOwnedEngine } from '../../../owned-layout';
import { textSelection } from '../../../state';
import type { StarterNode, TextBlockNode } from '../../demo-model';
import { demoSchema } from '../../demo-schema';
import { createStarterDocumentQuery } from '../document';
import { createDocumentLayout, type DocumentLayoutFrame } from '../document-layout';

let kit: CanvasKit;

beforeAll(async () => {
  kit = await CanvasKitInit({ locateFile: () => '/engines/canvaskit.wasm' });
});

async function nextFrame() {
  await Promise.resolve();

  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function paragraphs(count: number): TextBlockNode[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'paragraph',
    id: index + 1,
    key: `paragraph-${index + 1}`,
    text: `Paragraph ${index + 1}. Text wraps over several lines when the viewport becomes narrow.`,
    marks: [],
    inline: [],
  }));
}

async function fixture(nodes: StarterNode[]) {
  const owned = await createOwnedEngine(kit, 'shaping');
  const editor = createEditor({ schema: demoSchema, document: nodes });
  const project = createStarterDocumentQuery(demoSchema);

  const controller = createDocumentLayout({
    owned,
    size: 20,
    source: {
      getSnapshot: () => project(editor.state),
      subscribe: editor.subscribe,
    },
  });

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:500px;height:200px;overflow:auto;';
  const content = document.createElement('div');
  host.append(content);
  document.body.append(host);
  const reports: Parameters<DocumentLayoutFrame['onLayout']>[0][] = [];

  const frame = (overrides: Partial<DocumentLayoutFrame> = {}): DocumentLayoutFrame => ({
    viewport: {
      width: 500,
      zoom: 1,
      viewportHeight: 200,
      readScroll: () => host.scrollTop,
      scrollDocumentTo: (top) => {
        host.scrollTop = top;
      },
      setScroll: () => {},
    },
    panelId: undefined,
    focusedWidget: null,
    findBlockId: undefined,
    findOpen: false,
    eager: false,
    retainAll: false,
    onLayout: (result) => {
      reports.push(result);
    },
    ...overrides,
  });

  const present = () => {
    const snapshot = controller.getSnapshot();
    content.style.height = `${snapshot.scene.height * snapshot.scene.zoom}px`;
    controller.present(snapshot);
  };

  const detach = controller.attach();

  return {
    owned,
    editor,
    controller,
    host,
    content,
    reports,
    frame,
    present,
    detach,
    destroy() {
      controller.destroy();
      editor.destroy();
      owned.destroy();
      host.remove();
    },
  };
}

test('publishes caret and culled geometry without React and ignores callback-only updates', async () => {
  const f = await fixture(paragraphs(100));

  try {
    let publications = 0;

    const unsubscribe = f.controller.subscribe(() => {
      publications++;
      f.present();
    });

    f.controller.update(f.frame());
    const first = f.controller.getSnapshot();
    expect(first.scene.placements).toHaveLength(100);
    expect(first.visible.length).toBeLessThan(10);
    expect(first.caret).toEqual(first.activePlacement?.layout?.geometry(0, 0, false).caret);
    let callbackCalls = 0;
    f.controller.update(
      f.frame({
        onLayout: () => {
          callbackCalls++;
        },
      }),
    );
    expect(callbackCalls).toBe(0);
    expect(f.controller.getSnapshot()).toBe(first);
    expect(publications).toBe(1);
    const beforeSelection = publications;
    f.editor.select(textSelection(79, 2));
    f.editor.select(textSelection(80, 10));
    await Promise.resolve();
    expect(publications).toBe(beforeSelection + 1);
    expect(callbackCalls).toBe(1);
    expect(f.controller.getSnapshot().activePlacement?.node.id).toBe(80);
    f.controller.update(f.frame({ panelId: 90, focusedWidget: 95, findBlockId: 98 }));
    const pinned = f.controller.getSnapshot();
    expect(pinned.activePlacement?.node.id).toBe(80);
    expect(pinned.caret).toEqual(pinned.activePlacement?.layout?.geometry(10, 10, false).caret);
    expect(pinned.visible.map((p) => p.node.id)).toEqual(expect.arrayContaining([90, 95, 98]));
    expect(pinned.visible.map((p) => p.y)).toEqual(
      pinned.visible.map((p) => p.y).toSorted((a, b) => a - b),
    );
    f.host.scrollTop = pinned.scene.placements[50].y;
    f.controller.update(f.frame());
    expect(f.controller.getSnapshot().visible.some((p) => p.node.id === 51)).toBe(true);
    expect(f.controller.getSnapshot().visible.some((p) => p.node.id === 1)).toBe(false);
    unsubscribe();
  } finally {
    f.destroy();
  }
});

test('coalesces measurements, rejects stale widths and anchors after the host applies the new height', async () => {
  const f = await fixture([
    { kind: 'checklist', id: 500, key: 'checklist-500', checked: [], expanded: false, notes: '' },
    ...paragraphs(30),
  ]);

  try {
    f.controller.update(f.frame());
    f.present();
    f.host.scrollTop = f.controller.getSnapshot().scene.placements[5].y + 7;
    f.controller.update(f.frame());
    f.present();
    const before = f.controller.getSnapshot();
    const scroll = f.host.scrollTop;
    const reports = f.reports.length;
    f.controller.measure(500, before.contentWidth - 1, 800);
    f.controller.measure(500, before.contentWidth, Number.NaN);
    f.controller.measure(9999, before.contentWidth, 800);
    await nextFrame();
    expect(f.reports).toHaveLength(reports);
    f.controller.measure(500, before.contentWidth, 400);
    f.controller.measure(500, before.contentWidth, 600);
    await nextFrame();
    const after = f.controller.getSnapshot();
    expect(f.reports).toHaveLength(reports + 1);
    expect(after.scene.placements[0].height).toBe(600);
    expect(before.scene.placements[0].height).toBe(190);
    expect(f.host.scrollTop).toBe(scroll);
    f.controller.present(before);
    expect(f.host.scrollTop).toBe(scroll);
    f.present();
    expect(f.host.scrollTop - after.scene.placements[5].y).toBeCloseTo(7);
    f.controller.measure(500, before.contentWidth, 600);
    await nextFrame();
    expect(f.reports).toHaveLength(reports + 1);
    const narrow = f.frame();
    f.controller.update({ ...narrow, viewport: { ...narrow.viewport, width: 350 } });
    f.controller.measure(500, before.contentWidth, 900);
    expect(f.controller.diagnostics.measurements.get(500)?.height).toBe(600);
  } finally {
    f.destroy();
  }
});

test('background work uses the latest viewport and finishes after ordinary updates without advancing them', async () => {
  const f = await fixture(paragraphs(360));

  try {
    f.controller.subscribe(f.present);
    f.controller.update(f.frame());
    expect(f.controller.getSnapshot().scene.pending).toBeGreaterThan(0);
    const narrow = f.frame();
    f.controller.update({ ...narrow, viewport: { ...narrow.viewport, width: 300 } });
    expect(f.reports.every((r) => r.background === 0)).toBe(true);
    let latestReports = 0;
    const next = f.frame();
    f.controller.update({
      ...next,
      viewport: { ...next.viewport, width: 300 },
      onLayout: () => {
        latestReports++;
      },
    });
    // No host update: the scheduled frame must read the live scroll position itself.
    f.host.scrollTop = f.controller.getSnapshot().scene.placements[200].y;
    const atUpdate = latestReports;
    await expect.poll(() => f.controller.getSnapshot().scene.pending).toBe(0);
    expect(latestReports).toBeGreaterThan(atUpdate);
    const final = f.controller.getSnapshot();
    expect(final.visible.some((p) => p.node.id === 201)).toBe(true);
    expect(final.visible.every((p) => p.layout !== null && p.layoutWidth === 244)).toBe(true);
    expect(f.controller.diagnostics.cachedParagraphs).toBe(360);
    expect(f.controller.diagnostics.residentParagraphs).toBeLessThan(
      f.controller.diagnostics.cachedParagraphs,
    );
    expect(final.scene.placements[99].layout).toBeNull();
  } finally {
    f.destroy();
  }
});

test('successive unpublished layouts preserve the pending anchor but do not undo a new user scroll', async () => {
  const f = await fixture(paragraphs(120));

  try {
    f.controller.update(f.frame());
    f.present();
    f.host.scrollTop = f.controller.getSnapshot().scene.placements[60].y + 5;
    f.controller.update(f.frame());
    f.present();
    const initial = f.controller.getSnapshot();
    const narrow = f.frame();
    f.controller.update({ ...narrow, viewport: { ...narrow.viewport, width: 300 } });
    const unpublished = f.controller.getSnapshot();
    expect(unpublished.top - unpublished.scene.placements[60].y).toBeCloseTo(5);
    f.controller.update({
      ...f.frame(),
      viewport: { ...narrow.viewport, width: 300 },
      findOpen: true,
    });
    const latest = f.controller.getSnapshot();
    expect(latest.top - latest.scene.placements[60].y).toBeCloseTo(5);
    expect(f.host.scrollTop).toBe(initial.top);
    f.present();
    expect(f.host.scrollTop - latest.scene.placements[60].y).toBeCloseTo(5);
    const wider = f.frame();
    f.controller.update(wider);
    f.host.scrollTop = 0;
    f.present();
    expect(f.host.scrollTop).toBe(0);
    expect(f.controller.getSnapshot().top).toBe(0);
  } finally {
    f.destroy();
  }
});

test('detach cancels work and releases its owner; remount ignores stale cleanup and destroy is terminal', async () => {
  const f = await fixture(paragraphs(360));

  try {
    f.controller.update(f.frame());
    expect(f.controller.getSnapshot().scene.pending).toBeGreaterThan(0);
    expect(f.owned.retention().owners).toBe(1);
    f.detach();
    const reports = f.reports.length;
    f.editor.select(textSelection(80, 10));
    await nextFrame();
    expect(f.reports).toHaveLength(reports);
    expect(f.owned.retention().owners).toBe(0);
    expect(f.controller.getSnapshot().scene.placements).toHaveLength(0);
    f.controller.attach();
    f.controller.update(f.frame());
    f.detach();
    expect(f.owned.retention().owners).toBe(1);
    const reportsBeforeDestroy = f.reports.length;
    f.controller.destroy();
    f.controller.destroy();
    await nextFrame();
    expect(f.reports).toHaveLength(reportsBeforeDestroy);
    expect(f.owned.retention().owners).toBe(0);
    expect(() => f.controller.attach()).toThrow(/destroyed/);
    expect(() => f.controller.update(f.frame())).toThrow(/destroyed/);
    expect(() => f.controller.measure(1, 444, 40)).toThrow(/destroyed/);
    expect(() => f.controller.layoutFor(1)).toThrow(/destroyed/);
    expect(() =>
      f.owned.layoutText({
        text: 'The borrowed runtime is still usable',
        width: 300,
        size: 20,
        spans: [],
      }),
    ).not.toThrow();
  } finally {
    f.destroy();
  }
});
