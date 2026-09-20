import type { CanvasKit } from 'canvaskit-wasm';
import type { createOwnedEngine } from './owned-layout';

export function checkOwnedPipeline(owned: Awaited<ReturnType<typeof createOwnedEngine>>, kit: CanvasKit) {
  const checks: Record<string, boolean> = {};
  const { engine, stats } = owned;
  engine.clear();
  const blocks = Array.from({ length: 500 }, (_, i) => `Paragraph ${i}: office affinity and café accents.`);
  function layout(parts: string[], id = 110, width = 300) {
    const before = { ...stats };
    const snapshot = engine.layout({ id, text: parts.join('\n'), spans: [], width, size: 20 });
    return {
      snapshot,
      shaped: stats.shapeCalls - before.shapeCalls,
      composed: stats.compositions - before.compositions,
      buffers: stats.renderBuffers - before.renderBuffers,
    };
  }
  const initial = layout(blocks);
  checks.pipelineCold = initial.shaped === 500 && initial.composed === 500;
  const unchanged = layout(blocks);
  checks.pipelineUnchanged = unchanged.shaped === 0 && unchanged.composed === 0 && unchanged.buffers === 0;
  const edited = [...blocks];
  edited[20] += ' Additional text to cause a different paragraph height.'.repeat(5);
  const changed = layout(edited);
  checks.pipelineOneParagraph = changed.shaped === 1 && changed.composed === 1 && changed.buffers === 1;
  const cold = layout(edited, 111).snapshot;
  checks.pipelinePlacedLines = JSON.stringify(changed.snapshot.lines) === JSON.stringify(cold.lines);
  const text = edited.join('\n');
  checks.pipelineInteractionMatchesCold = [0, 15, text.indexOf('Paragraph 21'), text.length].every(index => {
    const warmGeometry = changed.snapshot.geometry(0, index, false);
    const coldGeometry = cold.geometry(0, index, false);
    const rect = warmGeometry.caret;
    return JSON.stringify(warmGeometry) === JSON.stringify(coldGeometry)
      && JSON.stringify(changed.snapshot.hit(rect[0], (rect[1] + rect[3]) / 2)) === JSON.stringify(cold.hit(rect[0], (rect[1] + rect[3]) / 2))
      && JSON.stringify(changed.snapshot.move(index, false, 'down')) === JSON.stringify(cold.move(index, false, 'down'));
  });
  const moved = layout([...edited].reverse());
  checks.pipelineReorder = moved.shaped === 0 && moved.composed === 0 && moved.buffers === 0;
  const resized = layout([...edited].reverse(), 110, 200);
  checks.pipelineResize = resized.shaped === 0 && resized.composed === 500;
  const oldGeometry = initial.snapshot.geometry(0, 25, false);
  checks.pipelineOldSnapshot = JSON.stringify(oldGeometry) === JSON.stringify(layout(blocks, 112).snapshot.geometry(0, 25, false));
  const fixture = ['office café', '', 'A paragraph that wraps when the width is narrow.'];
  const small = layout(fixture, 113, 120).snapshot;
  const newline = fixture[0].length;
  checks.pipelineHardBreakNavigation = small.move(newline, false, 'right').index === newline + 1 && small.move(newline + 1, false, 'left').index === newline;
  const before = { ...stats };
  for (let i = 0; i < 10; i++) {
    small.hit(30, i * 10);
    small.geometry(0, 5, false);
    small.move(3, false, 'right');
  }
  const surface = kit.MakeSurface(300, 300);
  if (!surface) throw new Error('Could not create pipeline test surface');
  try {
    small.draw(surface.getCanvas(), 0, 0);
    small.draw(surface.getCanvas(), 0, 0);
    surface.flush();
  } finally { surface.dispose(); }
  checks.pipelineInteractionAndPaintReuse = stats.shapeCalls === before.shapeCalls && stats.compositions === before.compositions && stats.renderBuffers === before.renderBuffers;
  engine.clear();
  return checks;
}
