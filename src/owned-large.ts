import type { CanvasKit } from 'canvaskit-wasm';
import type { LaidOut } from './engines';
import type { Span } from './model';
import { createOwnedEngine } from './owned-layout';

type Block = { text: string; spans: Span[] };
function fixture(count: number, styled: boolean): Block[] {
  return Array.from({ length: count }, (_, i) => {
    const text = `Paragraph ${i}: office affinity café with bold and italic words. Enough additional words to wrap across several lines.`;
    const from = text.indexOf('office'), second = text.indexOf('bold');
    return { text, spans: styled ? [
      { start: from, end: from + 6, bold: true, italic: false },
      { start: second, end: second + 15, bold: false, italic: true },
    ] : [] };
  });
}
function assemble(blocks: Block[]) {
  let offset = 0;
  const spans: Span[] = [];
  for (const block of blocks) {
    for (const span of block.spans) spans.push({ ...span, start: span.start + offset, end: span.end + offset });
    offset += block.text.length + 1;
  }
  return { text: blocks.map(b => b.text).join('\n'), spans };
}

export async function createLargeSession(kit: CanvasKit, storage: 'carets' | 'shaping', count: number, styled: boolean, api: 'whole' | 'blocks' = 'whole') {
  const owned = await createOwnedEngine(kit, storage);
  const blocks = fixture(count, styled);
  const input = { id: 1700, ...assemble(blocks), width: 480, size: 20 };
  const createdSurface = kit.MakeSurface(500, 640);
  if (!createdSurface) throw new Error('Large-document surface unavailable');
  const surface = createdSurface;
  let current: LaidOut | undefined;
  let document: ReturnType<typeof owned.createBlockDocument> | undefined;
  const checks: Record<string, boolean> = {};
  function check(name: string, ok: boolean) { checks[name] = (checks[name] ?? true) && ok; }
  function draw(layout: LaidOut, y = 0) {
    const t = performance.now();
    const canvas = surface.getCanvas();
    canvas.clear(kit.WHITE);
    layout.draw(canvas, 4, 4 - y);
    surface.flush();
    return performance.now() - t;
  }
  function pixels(layout: LaidOut, y: number) {
    draw(layout, y);
    const image = surface.makeImageSnapshot();
    const bytes = image.encodeToBytes();
    image.delete();
    if (!bytes) throw new Error('Large-document raster unavailable');
    return bytes;
  }
  function compare(a: LaidOut, b: LaidOut, text: string, label: string) {
    check(`${label}:lines`, JSON.stringify(a.lines) === JSON.stringify(b.lines));
    check(`${label}:height`, a.height === b.height);
    for (const index of [0, text.indexOf('office'), text.indexOf('office', Math.floor(text.length / 2)), text.length]) {
      for (const upstream of [false, true]) {
        const ga = a.geometry(index, index, upstream), gb = b.geometry(index, index, upstream);
        check(`${label}:caret`, JSON.stringify(ga) === JSON.stringify(gb));
        const y = (ga.caret[1] + ga.caret[3]) / 2;
        check(`${label}:hit`, JSON.stringify(a.hit(ga.caret[0], y)) === JSON.stringify(b.hit(gb.caret[0], y)));
        for (const direction of ['left','right','up','down','home','end'] as const) {
          check(`${label}:move`, JSON.stringify(a.move(index, upstream, direction)) === JSON.stringify(b.move(index, upstream, direction)));
        }
      }
    }
    for (const y of [0, a.height / 2, Math.max(0, a.height - 640)]) {
      const x = pixels(a, y), z = pixels(b, y);
      check(`${label}:pixels`, x.length === z.length && x.every((byte, i) => byte === z[i]));
    }
  }
  function release() { current = undefined; owned.engine.clear(); document = undefined; }
  function cold() {
    release();
    const t = performance.now();
    if (api === 'blocks') document = owned.createBlockDocument(input);
    const before = { ...owned.stats };
    current = document ? document.splice(0, 0, blocks) : owned.engine.layout(input);
    const layoutMs = performance.now() - t;
    const drawMs = draw(current);
    check('cold:compositions', owned.stats.compositions - before.compositions === count);
    check('cold:shapeCalls', owned.stats.shapeCalls - before.shapeCalls === count * (styled ? 6 : 1));
    return { layoutMs, drawMs, totalMs: layoutMs + drawMs, lines: current.lines.length, characters: input.text.length, spans: input.spans.length };
  }
  return {
    cold,
    warm() { cold(); release(); },
    state() { return { memory: owned.memory(), retention: owned.retention(), snapshot: !!current }; },
    release,
    async stream(chunkSize: number) {
      release();
      if (api === 'blocks') document = owned.createBlockDocument(input);
      // Serialized chunks simulate completed paragraphs arriving. Fixture creation
      // and transport delay are excluded; parsing, assembly, layout and draw are timed.
      const chunks: string[] = [];
      for (let i = 0; i < count; i += chunkSize) chunks.push(JSON.stringify(blocks.slice(i, i + chunkSize)));
      const received: Block[] = [];
      const samples = [];
      const start = performance.now();
      let first: LaidOut | undefined, firstLines = '', firstCaret = '';
      for (const chunk of chunks) {
        const t = performance.now();
        // Locally generated fixture data, not an external application boundary.
        const next: Block[] = JSON.parse(chunk);
        received.push(...next);
        const assembled = api === 'whole' ? assemble(received) : undefined;
        const assembledAt = performance.now(), before = { ...owned.stats };
        current = document ? document.splice(document.blockCount, 0, next) : owned.engine.layout({ ...input, ...assembled });
        const laidOut = performance.now();
        const drawMs = draw(current);
        const finished = performance.now();
        if (document) check('stream:onlyNewBlocksValidated', owned.stats.validatedBlocks - before.validatedBlocks === next.length);
        check('stream:onlyNewParagraphsCompose', owned.stats.compositions - before.compositions === next.length);
        check('stream:onlyNewParagraphsShape', owned.stats.shapeCalls - before.shapeCalls === next.length * (styled ? 6 : 1));
        samples.push({ paragraphs: received.length, assembleMs: assembledAt - t, layoutMs: laidOut - assembledAt, drawMs, updateMs: finished - t, elapsedMs: finished - start });
        if (!first) { first = current; firstLines = JSON.stringify(first.lines); firstCaret = JSON.stringify(first.geometry(0, 12, false)); }
        // Give the browser an opportunity to process input between deliveries.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (!current || !first) throw new Error('No streamed layout');
      check('stream:oldSnapshot', JSON.stringify(first.lines) === firstLines && JSON.stringify(first.geometry(0, 12, false)) === firstCaret);
      const final = current;
      const reference = owned.engine.layout({ ...input, id: 1701 });
      compare(final, reference, input.text, 'stream-vs-cold');
      owned.release(1701);
      first = undefined;
      return { chunkSize, samples, totalWorkMs: samples.reduce((n, s) => n + s.updateMs, 0), firstSubmittedMs: samples[0].elapsedMs, finalSubmittedMs: samples[samples.length - 1].elapsedMs };
    },
    fragments() {
      const whole = assemble(blocks.slice(0, 40));
      let previousBreaks = 0, first: LaidOut | undefined, firstLines = '';
      let final: LaidOut | undefined;
      let chunks = 0;
      // Variable character chunks include splits inside words, formatting spans
      // and the combining-accent sequence. No incomplete surrogate pairs here.
      const cuts = new Set<number>();
      for (let end = 17; end < whole.text.length; end += 61) cuts.add(end);
      cuts.add(whole.text.indexOf('é') + 1);
      cuts.add(whole.text.length);
      for (const end of [...cuts].sort((a, b) => a - b)) {
        const text = whole.text.slice(0, end);
        const spans = whole.spans.filter(s => s.start < end).map(s => ({ ...s, end: Math.min(s.end, end) }));
        const before = owned.stats.compositions;
        final = owned.engine.layout({ ...input, id: 1702, text, spans });
        const breaks = text.split('\n').length - 1;
        check('fragments:boundedComposition', owned.stats.compositions - before <= breaks - previousBreaks + 1);
        previousBreaks = breaks;
        chunks++;
        if (!first) { first = final; firstLines = JSON.stringify(first.lines); }
      }
      if (!final || !first) throw new Error('No fragment layout');
      const reference = owned.engine.layout({ ...input, id: 1703, ...whole });
      compare(final, reference, whole.text, 'fragments-vs-cold');
      check('fragments:oldSnapshot', JSON.stringify(first.lines) === firstLines);
      owned.release(1702); owned.release(1703);
      return { chunks, characters: whole.text.length, checks: { ...checks } };
    },
    validateAndEdit() {
      if (!current) throw new Error('Load document first');
      const initial = current;
      let before = { ...owned.stats }, t = performance.now();
      const unchanged = document ? document.snapshot() : owned.engine.layout(input);
      const unchangedMs = performance.now() - t;
      check('unchanged:reuse', owned.stats.shapeCalls === before.shapeCalls && owned.stats.compositions === before.compositions);
      const middle = Math.floor(count / 2), changed = [...blocks];
      changed[middle] = { ...blocks[middle], text: blocks[middle].text + ' More text for an edit.' };
      const edited = { ...input, ...assemble(changed) };
      before = { ...owned.stats }; t = performance.now();
      current = document ? document.splice(middle, 1, [changed[middle]]) : owned.engine.layout(edited);
      const editMs = performance.now() - t;
      if (document) check('edit:oneBlockValidated', owned.stats.validatedBlocks - before.validatedBlocks === 1);
      check('edit:oneParagraph', owned.stats.compositions - before.compositions === 1 && owned.stats.shapeCalls - before.shapeCalls === (styled ? 6 : 1));
      const expectedEdit = owned.engine.layout({ ...edited, id: 1701 });
      compare(current, expectedEdit, edited.text, 'edit-vs-cold');
      owned.release(1701);
      before = { ...owned.stats }; t = performance.now();
      current = document ? document.configure({ width: 310, size: input.size }) : owned.engine.layout({ ...edited, width: 310 });
      const resizeMs = performance.now() - t;
      if (document) check('resize:noValidation', owned.stats.validatedBlocks === before.validatedBlocks);
      check('resize:reuseShaping', owned.stats.shapeCalls === before.shapeCalls && owned.stats.compositions - before.compositions === count);
      const expectedResize = owned.engine.layout({ ...edited, width: 310, id: 1701 });
      compare(current, expectedResize, edited.text, 'resize-vs-cold');
      owned.release(1701);
      compare(initial, unchanged, input.text, 'old-snapshot');
      const resized = current;
      const viewportDrawMs = [0, resized.height / 2, Math.max(0, resized.height - 640)].map(y => draw(resized, y));
      return { unchangedMs, editMs, resizeMs, viewportDrawMs, checks: { ...checks } };
    },
    dispose() { release(); surface.dispose(); },
  };
}
