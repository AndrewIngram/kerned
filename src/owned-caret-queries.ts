import type { CanvasKit } from 'canvaskit-wasm';
import { boundaries } from './model';
import { createOwnedEngine } from './owned-layout';

export async function benchmarkCaretQueries(kit: CanvasKit) {
  const variants = [await createOwnedEngine(kit), await createOwnedEngine(kit, 'carets')];
  const results = [];
  const operations = ['caret', 'hit', 'move', 'selection'] as const;
  for (const kind of ['500 paragraphs', 'long paragraph']) {
    const text = kind === '500 paragraphs'
      ? Array.from({ length: 500 }, (_, i) => `Paragraph ${i}: office affinity and café accents.`).join('\n')
      : 'office affinity and café accents. '.repeat(700);
    const layouts = variants.map(v => v.engine.layout({ id: 960, text, spans: [], width: 350, size: 20 }));
    const stops = boundaries(text);
    for (const operation of operations) {
      const queries = 5000;
      const samples: number[][] = [[], []];
      let equivalent = true;
      for (let trial = -4; trial < 20; trial++) {
        const checksums = [0, 0];
        for (const variant of trial % 2 === 0 ? [0, 1] : [1, 0]) {
          const layout = layouts[variant];
          let checksum = 0;
          const start = performance.now();
          for (let i = 0; i < queries; i++) {
            const ordinal = (i * 7919) % stops.length, index = stops[ordinal];
            if (operation === 'caret') checksum += layout.geometry(index, index, false).caret[0];
            else if (operation === 'hit') checksum += layout.hit(i % 350, (i * 113) % layout.height).index;
            else if (operation === 'move') checksum += layout.move(index, false, i % 2 ? 'left' : 'right').index;
            else {
              const geometry = layout.geometry(index, stops[Math.min(stops.length - 1, ordinal + 30)], false);
              checksum += geometry.caret[0] + geometry.rects.length;
            }
          }
          const elapsed = performance.now() - start;
          checksums[variant] = checksum;
          if (trial >= 0) samples[variant].push(elapsed);
        }
        equivalent &&= checksums[0] === checksums[1];
      }
      results.push({ kind, operation, queries, equivalent, variants: samples.map((values, i) => {
        const sorted = [...values].sort((a,b)=>a-b);
        return { name: i === 0 ? 'objects' : 'packed carets', medianBatchMs: (sorted[9]+sorted[10])/2, p95BatchMs: sorted[18], samples: values };
      }) });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    layouts.forEach(l=>l.dispose());
  }
  variants.forEach(v=>v.engine.clear());
  return { batches: 20, warmups: 4, results };
}
