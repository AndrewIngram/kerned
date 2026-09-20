import type { CanvasKit } from 'canvaskit-wasm';
import type { Engine, LaidOut } from './engines';
import { boundaries, type Direction, type Span } from './model';
import { createOwnedEngine } from './owned-layout';
import { checkOwnedRetention } from './owned-retention-checks';
import { checkOwnedPipeline } from './owned-pipeline-checks';

export async function validateOwnedSizes(kit: CanvasKit, reference: Engine, comparison: 'packed' | 'carets' | 'shaping' = 'packed') {
  const object = await createOwnedEngine(kit);
  const packed = await createOwnedEngine(kit, comparison);
  const failures: string[] = [];
  let cases = 0, assertions = 0;
  function check(ok: boolean, detail: string) { assertions++; if (!ok && failures.length < 30) failures.push(detail); }
  function compare(a: unknown, b: unknown, detail: string) { check(JSON.stringify(a) === JSON.stringify(b), detail); }
  const fixtures: { name: string; text: string; spans: Span[] }[] = [
    { name: 'empty', text: '', spans: [] },
    { name: 'blank-lines', text: '\n\na\n\n', spans: [] },
    { name: 'whitespace', text: '   word  word   \n ', spans: [] },
    { name: 'ligatures', text: 'office affinity efficient ffi fi AV To', spans: [] },
    { name: 'accents', text: 'café café naïve naïve Ångström', spans: [] },
    { name: 'long-word', text: 'supercalifragilisticexpialidocious'.repeat(8), spans: [] },
    { name: 'styled', text: 'bold italic office café', spans: [{ start: 0, end: 4, bold: true, italic: false }, { start: 5, end: 11, bold: false, italic: true }, { start: 12, end: 18, bold: true, italic: true }] },
  ];
  const directions: Direction[] = ['left', 'right', 'up', 'down', 'home', 'end'];
  function validate(a: LaidOut, b: LaidOut, text: string, label: string) {
    compare(a.lines, b.lines, `${label}: lines`);
    check(Number.isFinite(a.height) && a.height > 0, `${label}: height`);
    check(a.lines.every(l => [l.width, l.top, l.bottom, l.baseline].every(Number.isFinite) && l.end >= l.start && l.bottom > l.top), `${label}: line bounds`);
    const stops = boundaries(text), valid = new Set(stops);
    const chosen = stops.filter((_, i) => i % Math.max(1, Math.floor(stops.length / 24)) === 0);
    if (!chosen.includes(text.length)) chosen.push(text.length);
    for (const index of chosen) {
      for (const affinity of [false, true]) {
        const g = a.geometry(index, index, affinity), h = b.geometry(index, index, affinity);
        compare(g, h, `${label}: caret ${index}/${affinity}`);
        for (const direction of directions) compare(a.move(index, affinity, direction), b.move(index, affinity, direction), `${label}: affinity ${affinity} ${direction}`);
        const point = a.hit(g.caret[0], (g.caret[1] + g.caret[3]) / 2);
        check(point.index === index, `${label}: roundtrip ${index}/${affinity} -> ${point.index}`);
      }
      for (const direction of directions) {
        const p = a.move(index, false, direction);
        check(valid.has(p.index), `${label}: ${direction} non-grapheme ${p.index}`);
        compare(p, b.move(index, false, direction), `${label}: ${direction} mismatch`);
      }
    }
    for (const row of [a.lines[0], a.lines[Math.floor(a.lines.length / 2)], a.lines[a.lines.length - 1]]) {
      for (const x of [-100, 0, 0.125, row.width / 2, row.width, row.width + 100]) {
        compare(a.hit(x, (row.top + row.bottom) / 2), b.hit(x, (row.top + row.bottom) / 2), `${label}: hit ${x}`);
      }
    }
    for (const [anchor, focus] of [[0, text.length], [text.length, 0], [chosen[1] ?? 0, chosen.at(-2) ?? 0]]) {
      const g = a.geometry(anchor, focus, false);
      compare(g, b.geometry(anchor, focus, false), `${label}: selection`);
      check(g.rects.every(r => r.every(Number.isFinite) && r[2] >= r[0] && r[3] > r[1]), `${label}: selection bounds`);
    }
  }
  // Single-line widths provide an independent Parley check, rather than only
  // comparing two variants of our own composition implementation.
  for (const size of [8, 12, 20, 37.5, 72, 128]) {
    const input = { id: 800, text: 'office affinity café AV To', spans: [], width: 10000, size };
    const a = object.engine.layout(input), b = reference.layout(input);
    check(Math.abs(a.lines[0].width - b.lines[0].width) < 0.15, `reference width size ${size}`);
    a.dispose(); b.dispose();
    for (const width of [1, 16, 120, 333.3, 800, 2400]) {
      for (const fixture of fixtures) {
        const input = { id: 801, text: fixture.text, spans: fixture.spans, width, size };
        const a = object.engine.layout(input), b = packed.engine.layout(input);
        validate(a, b, input.text, `${fixture.name} ${size}px/${width}px`);
        a.dispose(); b.dispose(); cases++;
      }
    }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  for (const count of [1, 100, 500, 2000]) {
    const text = Array.from({ length: count }, (_, i) => `Paragraph ${i}: office café AV To.`).join('\n');
    const input = { id: 802, text, spans: [], width: 333.3, size: 17.3 };
    const a = object.engine.layout(input), b = packed.engine.layout(input);
    validate(a, b, text, `${count} paragraphs`);
    const changed = { ...input, text: text.replace('Paragraph 0:', 'Edited paragraph 0:') };
    const before = { ...packed.stats };
    const warm = packed.engine.layout(changed);
    const cold = object.engine.layout({ ...changed, id: 803 });
    compare(warm.lines, cold.lines, `${count}: edit vs cold`);
    check(packed.stats.shapeCalls - before.shapeCalls === 1 && packed.stats.compositions - before.compositions === 1, `${count}: invalidation`);
    a.dispose(); b.dispose(); warm.dispose(); cold.dispose(); cases++;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  for (const text of ['office café '.repeat(1000), 'a'.repeat(10000)]) {
    const input = { id: 804, text, spans: [], width: 333.3, size: 17.3 };
    const a = object.engine.layout(input), b = packed.engine.layout(input);
    validate(a, b, text, `long paragraph ${text.length}`);
    a.dispose(); b.dispose(); cases++;
  }
  // Compare actual rasterized output at several sizes, including fractional DPR.
  // No screenshot comparison tolerance: the two paths should submit identical glyphs.
  for (const size of [8, 20, 37.5, 72]) for (const dpr of [1, 1.5, 2]) {
    const fixture = fixtures[6];
    const input = { id: 805, text: fixture.text, spans: fixture.spans, width: 160, size };
    function pixels(engine: Engine) {
      const layout = engine.layout(input);
      const surface = kit.MakeSurface(Math.ceil(200 * dpr), Math.ceil(layout.height * dpr + 20));
      if (!surface) throw new Error('Validation surface unavailable');
      const canvas = surface.getCanvas();
      canvas.clear(kit.WHITE); canvas.scale(dpr, dpr); layout.draw(canvas, 4, 4); surface.flush();
      const image = surface.makeImageSnapshot();
      const bytes = image.encodeToBytes();
      image.delete(); surface.dispose(); layout.dispose();
      if (!bytes) throw new Error('Validation image unavailable');
      return bytes;
    }
    const a = pixels(object.engine), b = pixels(packed.engine);
    check(a.length === b.length && a.every((byte, i) => byte === b[i]), `raster ${size}px @${dpr}`);
  }
  for (const [name, passed] of Object.entries({ ...checkOwnedRetention(packed), ...checkOwnedPipeline(packed, kit) })) check(passed, `lifetime:${name}`);
  object.engine.clear(); packed.engine.clear();
  return { comparison, cases, assertions, failures, sizes: [8, 12, 20, 37.5, 72, 128], widths: [1, 16, 120, 333.3, 800, 2400], paragraphCounts: [1, 100, 500, 2000], rasterCases: 12 };
}
