import type { CanvasKit } from 'canvaskit-wasm';
import { createOwnedEngine } from './owned-layout';

type Scenario = 'cold' | 'edit' | 'resize';
export async function benchmarkOwnedStorage(kit: CanvasKit, comparison: 'packed' | 'carets' | 'shaping' = 'packed') {
  const variants = [await createOwnedEngine(kit, comparison === 'shaping' ? 'carets' : 'objects'), await createOwnedEngine(kit, comparison)];
  const scenarios: Scenario[] = ['cold', 'edit', 'resize'];
  const results = [];
  const fixtures = [
    { name: '100 paragraphs', count: 100, size: 20, width: 450, repeats: 1 },
    { name: '500 small-text paragraphs', count: 500, size: 12, width: 240, repeats: 1 },
    { name: '500 large-text paragraphs', count: 500, size: 37.5, width: 900, repeats: 1 },
    { name: 'one long paragraph', count: 1, size: 20, width: 450, repeats: 200 },
  ];
  for (const fixture of fixtures) for (const scenario of scenarios) {
    const samples: number[][] = [[], []];
    const checks: boolean[] = [];
    for (let trial = -6; trial < 30; trial++) {
      const text = Array.from({ length: fixture.count }, (_, i) => `Trial ${String(trial + 6).padStart(3, '0')}, paragraph ${i}: ` + 'office affinity café AV To with enough words to wrap. '.repeat(fixture.repeats)).join('\n');
      const insertion = text.indexOf('office', Math.floor(text.length / 2));
      const edit = text.slice(0, insertion) + 'new ' + text.slice(insertion);
      for (const index of trial % 2 === 0 ? [0, 1] : [1, 0]) {
        const variant = variants[index];
        variant.engine.clear();
        const input = { id: 901, text, spans: [], width: fixture.width, size: fixture.size };
        if (scenario !== 'cold') variant.engine.layout(input).dispose();
        const measured = { ...input, text: scenario === 'edit' ? edit : text, width: scenario === 'resize' ? fixture.width * 0.73 : fixture.width };
        const before = { ...variant.stats };
        const start = performance.now();
        const layout = variant.engine.layout(measured);
        const elapsed = performance.now() - start;
        if (trial >= 0) samples[index].push(elapsed);
        const shapes = scenario === 'cold' ? fixture.count : scenario === 'edit' ? 1 : 0;
        const compositions = scenario === 'edit' ? 1 : fixture.count;
        checks.push(variant.stats.shapeCalls - before.shapeCalls === shapes && variant.stats.compositions - before.compositions === compositions && layout.missing === 0);
        layout.dispose();
      }
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    results.push({ fixture, scenario, countsPassed: checks.every(Boolean), variants: samples.map((values, i) => {
      const sorted = [...values].sort((a, b) => a - b);
      return { name: i === 0 ? (comparison === 'shaping' ? 'packed carets' : 'objects') : comparison === 'shaping' ? 'packed shaping' : comparison === 'carets' ? 'packed carets' : 'packed placement', medianMs: (sorted[14] + sorted[15]) / 2, p95Ms: sorted[28], samples: values };
    }) });
  }
  variants.forEach(v => v.engine.clear());
  return { comparison, warmups: 6, repetitions: 30, methodology: 'Alternating variant order; same layout call; independent primed baselines; packing cost included in cold layout and changed-paragraph edits; no drawing or startup. Glyph packing adds a view alongside shaped clusters; caret packing instead replaces caret objects and offset maps. The shaping variant replaces retained shaped objects with packed columns and uses packed carets in both comparison arms.', results };
}
