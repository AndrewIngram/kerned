import type { Engine } from './engines';
import type { createOwnedEngine } from './owned-layout';

type Owned = Awaited<ReturnType<typeof createOwnedEngine>>;
type Scenario = 'cold-layout' | 'edit' | 'resize';
const orders = [[0, 1, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0], [1, 0, 2], [0, 2, 1]];
const warmups = 6;
const repetitions = 30;

function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

// Every trial has an independently primed cache. A unique equal-length prefix
// avoids accidentally measuring a previously shaped document in another trial.
export async function benchmarkOwned(engines: Engine[], owned: Owned) {
  const results = [];
  const scenarios: Scenario[] = ['cold-layout', 'edit', 'resize'];
  for (const paragraphs of [100, 500]) {
    for (const scenario of scenarios) {
      // Explicit sample type keeps the raw measurements available for inspection.
      const measurements: {
        totalMs: number;
        reportedCoreMs: number;
        shapeCalls: number | null;
        cacheHits: number | null;
        compositions: number | null;
        renderBuffers: number | null;
        lines: number;
      }[][] = engines.map(() => []);
      let textLength = 0;
      for (let trial = -warmups; trial < repetitions; trial++) {
        const prefix = String(trial + warmups).padStart(3, '0');
        const blocks = Array.from({ length: paragraphs }, (_, i) =>
          `Trial ${prefix}, paragraph ${i}: office affinity and café accents, with enough words to wrap at this width.`);
        const text = blocks.join('\n');
        textLength = text.length;
        const changed = [...blocks];
        const middle = Math.floor(paragraphs / 2);
        changed[middle] = changed[middle].replace('office', 'offices');
        const edited = changed.join('\n');
        for (const index of orders[(trial + warmups) % orders.length]) {
          const engine = engines[index];
          engine.clear();
          const input = { id: 90, text, spans: [], width: 450, size: 20 };
          if (scenario !== 'cold-layout') engine.layout(input).dispose();
          const shapeBefore = owned.stats.shapeCalls;
          const hitsBefore = owned.stats.cacheHits;
          const compositionsBefore = owned.stats.compositions;
          const buffersBefore = owned.stats.renderBuffers;
          const measured = {
            ...input,
            text: scenario === 'edit' ? edited : text,
            width: scenario === 'resize' ? 350 : 450,
          };
          const start = performance.now();
          const layout = engine.layout(measured);
          const totalMs = performance.now() - start;
          if (!Number.isFinite(layout.height) || layout.missing !== 0) throw new Error(`Invalid benchmark layout: ${engine.name}`);
          if (trial >= 0) measurements[index].push({
            totalMs,
            reportedCoreMs: layout.coreMs,
            shapeCalls: engine === owned.engine ? owned.stats.shapeCalls - shapeBefore : null,
            cacheHits: engine === owned.engine ? owned.stats.cacheHits - hitsBefore : null,
            compositions: engine === owned.engine ? owned.stats.compositions - compositionsBefore : null,
            renderBuffers: engine === owned.engine ? owned.stats.renderBuffers - buffersBefore : null,
            lines: layout.lines.length,
          });
          layout.dispose();
        }
        // Let browser GC and event processing run between trials, outside timing.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      results.push({
        paragraphs, textLength, scenario,
        engines: engines.map((engine, i) => ({
          engine: engine.name,
          totalMs: distribution(measurements[i].map(s => s.totalMs)),
          reportedCoreMs: distribution(measurements[i].map(s => s.reportedCoreMs)),
          samples: measurements[i],
        })),
      });
    }
  }
  return {
    methodology: {
      repetitions, warmups,
      order: 'All six engine permutations, repeated equally',
      cold: 'Application layout cache cleared; fonts, WASM, JIT and internal font caches already warm',
      edit: 'Independent baseline prime, then insert one character in the middle paragraph',
      resize: 'Independent baseline prime at 450px, then layout at 350px',
      timed: 'Synchronous Engine.layout call, including current adapters; excludes prime, clear, dispose, geometry queries, drawing, startup and event processing',
      p95: 'Nearest rank, sample 29 of 30 sorted observations',
      scope: 'Current whole-document adapters; not native engine maxima or main-editor block-cache performance',
    },
    results,
  };
}
