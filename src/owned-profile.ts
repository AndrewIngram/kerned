import type { CanvasKit } from 'canvaskit-wasm';
import { createOwnedEngine } from './owned-layout';

export async function createOwnedProfile(kit: CanvasKit, comparison: 'packed' | 'carets' = 'packed') {
  const engines = [await createOwnedEngine(kit), await createOwnedEngine(kit, comparison)];
  const blocks = Array.from({ length: 500 }, (_, i) => `Paragraph ${i}: office affinity café AV To with enough words to wrap.`);
  const text = blocks.join('\n');
  const input = { id: 950, text, spans: [], width: 240, size: 12 };
  const stats = () => engines.map(engine => ({ ...engine.stats }));
  return {
    prime() { engines.forEach(e => { e.engine.clear(); e.engine.layout(input).dispose(); }); },
    run(variant: number, scenario: 'cold' | 'edit' | 'resize', iterations: number) {
      const engine = engines[variant].engine;
      const before = stats();
      let checksum = 0;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        if (scenario === 'cold') engine.clear();
        const changed = scenario === 'edit' ? blocks.map((s, n) => n === 250 ? `${s} revision ${i}` : s).join('\n') : text;
        const layout = engine.layout({ ...input, text: changed, width: scenario === 'resize' ? (i % 2 ? 240 : 175.2) : 240 });
        checksum += layout.height;
        layout.dispose();
      }
      return { elapsedMs: performance.now() - start, checksum, before, after: stats() };
    },
  };
}
