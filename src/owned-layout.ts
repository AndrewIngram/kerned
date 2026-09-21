import type { CanvasKit, Font, Typeface } from 'canvaskit-wasm';
import { z } from 'zod';

import { readEditorAsset, type EditorAssetOptions } from './editor-canvas/assets';
import { fontFiles, type LayoutInput, type LaidOut } from './engines';
import { boundaries, type Span } from './layout-types';
import { createBlockSession } from './owned-blocks';
import { placeParagraphs } from './owned-document';
import { layoutInlineParagraph, type InlineAtom } from './owned-inline';
import { packGlyphs, type PackedGlyphs } from './owned-packed';
import {
  composeParagraph,
  type Glyph,
  type Cluster,
  type ParagraphGlyphs,
  type ComposedParagraph,
} from './owned-paragraph';
import { decodeShaping, type ShapingRun, type PackedShaping } from './owned-shaped';
import { emojiSequence, supportsOwnedText } from './owned-text-support';

export type OwnedStorage = 'objects' | 'packed' | 'carets' | 'shaping';

type PreparedParagraph = {
  paragraphGlyphs: ParagraphGlyphs | PackedShaping;
  composed: ComposedParagraph;
  packed: PackedGlyphs | undefined;
};

export async function createOwnedEngine(
  kit: CanvasKit,
  storage: OwnedStorage = 'objects',
  assets: EditorAssetOptions = {},
) {
  const [wasm, data] = await Promise.all([
    readEditorAsset('engines/owned.wasm', assets),
    Promise.all(fontFiles.map((f) => readEditorAsset(`fonts/${f}`, assets))),
  ]);

  assets.signal?.throwIfAborted();
  const { instance } = await WebAssembly.instantiate(wasm);
  assets.signal?.throwIfAborted();
  const exports = instance.exports;
  const exportedMemory = exports.memory;

  if (!(exportedMemory instanceof WebAssembly.Memory)) throw new Error('Invalid shaping memory');

  let runtime: { exports: WebAssembly.Exports; memory: WebAssembly.Memory } | undefined = {
    exports,
    memory: exportedMemory,
  };

  function currentRuntime() {
    if (!runtime) throw new Error('Layout resources are destroyed');

    return runtime;
  }

  function call(name: string, ...args: number[]): number {
    const fn = z
      .function({ input: z.tuple([]).rest(z.number()), output: z.number() })
      .parse(currentRuntime().exports[name]);

    const value: unknown = fn(...args);

    return z.number().parse(value);
  }

  function allocate(bytes: Uint8Array) {
    const ptr = call('allocate', bytes.length);
    new Uint8Array(currentRuntime().memory.buffer, ptr, bytes.length).set(bytes);

    return ptr;
  }

  const faces: Typeface[] = [];
  const paint = new kit.Paint();

  try {
    paint.setColor(kit.Color(37, 42, 35));
    paint.setAntiAlias(true);

    for (const [index, bytes] of data.entries()) {
      if (call('register_font', allocate(new Uint8Array(bytes)), bytes.byteLength) !== index)
        throw new Error('Font registration failed');
      const face = kit.Typeface.MakeFreeTypeFaceFromData(bytes);

      if (!face) throw new Error('Skia font registration failed');
      faces.push(face);
    }
  } catch (error) {
    for (const face of faces) face.delete();
    paint.delete();
    throw error;
  }

  const fonts = new Map<string, Font>();

  function font(id: number, size: number) {
    const key = `${id}:${size}`;
    let value = fonts.get(key);

    if (!value) {
      value = new kit.Font(faces[id], size);
      value.setSubpixel(true);
      fonts.set(key, value);
    }

    return value;
  }

  const stats = {
    glyphCalls: 0,
    cacheHits: 0,
    paragraphs: 0,
    lines: 0,
    compositions: 0,
    compositionHits: 0,
    renderBuffers: 0,
    validatedBlocks: 0,
    validatedCharacters: 0,
  };

  // Each input id owns only the shaping used by its latest successful layout.
  // Build the replacement separately so traversal and failed layouts cannot evict it.
  type RetainedParagraph = Omit<PreparedParagraph, 'composed'> & { composed?: ComposedParagraph };

  const cacheScopes = new Set<Map<number, Map<string, RetainedParagraph>>>();
  let destroyed = false;

  function assertActive() {
    if (destroyed) throw new Error('Layout resources are destroyed');
  }

  const blockSessions = new Set<{ retained(): PreparedParagraph[]; release(): void }>();

  function resolveGlyphBuffer(text: string, id: number, size: number): ShapingRun {
    const bytes = new TextEncoder().encode(text);
    const ptr = call('shape', id, allocate(bytes), bytes.length);

    if (!ptr) throw new Error('Shaping failed');
    const memory = currentRuntime().memory;
    const words = new Uint32Array(memory.buffer, ptr, call('result_words'));

    if (words.length !== 3 + words[0] * 5 + words[1]) throw new Error('Invalid shaping buffer');
    const floats = new Float32Array(memory.buffer, ptr, words.length);
    const scale = size / words[2];
    stats.glyphCalls++;

    return { words, floats, scale, font: id, offset: 0 };
  }

  function resolveGlyphRuns(text: string, id: number, size: number) {
    const base = resolveGlyphBuffer(text, id, size);
    const breakView = base.words.subarray(3 + base.words[0] * 5);

    // Keep the usual Latin path as a single shaping call and borrowed buffer.
    if (!emojiSequence.test(text)) return { runs: [base], breaks: breakView };
    const breaks = breakView.slice();

    const stops = boundaries(text),
      segments: { start: number; end: number; font: number }[] = [];

    for (let i = 0; i < stops.length - 1; i++) {
      const start = stops[i],
        end = stops[i + 1],
        value = text.slice(start, end);

      const chosen = emojiSequence.test(value) && !value.includes('\ufe0e') ? 4 : id;
      const last = segments.at(-1);

      if (last?.font === chosen) last.end = end;
      else segments.push({ start, end, font: chosen });
    }

    const runs = segments.map((segment) => {
      const run = resolveGlyphBuffer(text.slice(segment.start, segment.end), segment.font, size),
        words = run.words.slice();

      return { ...run, words, floats: new Float32Array(words.buffer), offset: segment.start };
    });

    return { runs, breaks };
  }

  function resolveGlyphs(text: string, id: number, size: number) {
    const result = resolveGlyphRuns(text, id, size),
      glyphs: Glyph[] = [];

    for (const run of result.runs)
      for (let i = 0; i < run.words[0]; i++) {
        const p = 3 + i * 5;
        glyphs.push({
          id: run.words[p],
          start: run.words[p + 1] + run.offset,
          advance: run.floats[p + 2] * run.scale,
          dx: run.floats[p + 3] * run.scale,
          dy: run.floats[p + 4] * run.scale,
          font: run.font,
        });
      }

    return { glyphs, breaks: [...result.breaks] };
  }

  const inkBounds = new Map<string, ReturnType<Font['getMetrics']>['bounds']>();
  const paragraphMetrics = new Map<string, { lineHeight: number; baseline: number }>();

  function prepare(
    text: string,
    spans: Span[],
    width: number,
    size: number,
    cached?: RetainedParagraph,
    requestedHeight = size * 1.6,
    grid = 0,
  ): PreparedParagraph {
    const metricKey = `${size}:${requestedHeight}:${grid}`;
    let metrics = paragraphMetrics.get(metricKey);

    if (!metrics) {
      const lineHeight = requestedHeight;
      const fontMetrics = font(0, size).getMetrics();
      metrics = {
        lineHeight,
        baseline:
          (lineHeight - (fontMetrics.descent - fontMetrics.ascent)) / 2 - fontMetrics.ascent,
      };

      if (grid) metrics.baseline = Math.round(metrics.baseline / grid) * grid;
      paragraphMetrics.set(metricKey, metrics);
    }

    const { lineHeight, baseline } = metrics;
    let paragraphGlyphs = cached?.paragraphGlyphs;

    if (paragraphGlyphs) stats.cacheHits++;
    else if (storage === 'shaping') {
      const base = resolveGlyphRuns(text, 0, size);

      if (!spans.length) paragraphGlyphs = decodeShaping(text, base.runs, base.breaks);
      else {
        // The native result is overwritten by each call. Preserve numeric
        // results for style runs; no glyph or cluster objects are created.
        const lineBreaks = base.breaks.slice();

        const cuts = [
          ...new Set([0, text.length, ...spans.flatMap((s) => [s.start, s.end])]),
        ].toSorted((a, b) => a - b);

        const runs: ShapingRun[] = [];

        for (let i = 0; i < cuts.length - 1; i++) {
          const start = cuts[i];
          const active = spans.filter((s) => s.start <= start && s.end > start);
          const id = Number(active.some((s) => s.bold)) + 2 * Number(active.some((s) => s.italic));

          for (const run of resolveGlyphRuns(text.slice(start, cuts[i + 1]), id, size).runs) {
            const words = run.words.slice();
            runs.push({
              ...run,
              words,
              floats: new Float32Array(words.buffer),
              offset: run.offset + start,
            });
          }
        }

        paragraphGlyphs = decodeShaping(text, runs, lineBreaks);
      }
    } else {
      const base = resolveGlyphs(text, 0, size);
      let glyphs = base.glyphs;

      if (spans.length) {
        const cuts = [
          ...new Set([0, text.length, ...spans.flatMap((s) => [s.start, s.end])]),
        ].toSorted((a, b) => a - b);

        glyphs = cuts.slice(0, -1).flatMap((start, i) => {
          const active = spans.filter((s) => s.start <= start && s.end > start);
          const id = Number(active.some((s) => s.bold)) + 2 * Number(active.some((s) => s.italic));

          return resolveGlyphs(text.slice(start, cuts[i + 1]), id, size).glyphs.map((g) => ({
            ...g,
            start: g.start + start,
          }));
        });
      }

      const clusters: Cluster[] = [];

      for (const glyph of glyphs) {
        let cluster = clusters.at(-1);

        if (!cluster || cluster.start !== glyph.start) {
          cluster = { start: glyph.start, end: text.length, width: 0, glyphs: [], stops: [] };

          if (clusters.length) clusters[clusters.length - 1].end = glyph.start;
          clusters.push(cluster);
        }

        cluster.glyphs.push(glyph);
        cluster.width += glyph.advance;
      }

      const graphemes = boundaries(text);
      let stopIndex = 1;

      for (const cluster of clusters) {
        while (stopIndex < graphemes.length && graphemes[stopIndex] <= cluster.end) {
          if (graphemes[stopIndex] > cluster.start) cluster.stops.push(graphemes[stopIndex]);
          stopIndex++;
        }
      }

      paragraphGlyphs = { clusters, breaks: new Set(base.breaks) };
    }

    const packed =
      cached?.packed ??
      ('clusterStarts' in paragraphGlyphs
        ? paragraphGlyphs.glyphs
        : storage === 'packed'
          ? packGlyphs(paragraphGlyphs)
          : undefined);

    let composed = cached?.composed;

    if (composed?.width === width) stats.compositionHits++;
    else {
      composed = composeParagraph(
        paragraphGlyphs,
        text.length,
        width,
        lineHeight,
        baseline,
        packed,
        storage === 'carets' || storage === 'shaping' ? 'packed' : 'objects',
      );
      includeInkBounds(composed, size);
      stats.compositions++;
      stats.renderBuffers += composed.runs.length;
    }

    return { paragraphGlyphs, composed, packed };
  }

  function includeInkBounds(composed: ComposedParagraph, size: number) {
    // Conservative font bounds include accents/marks outside the line box.
    // Cache metrics per font/size; never query glyph bounds on a draw or scroll.
    for (const run of composed.runs) {
      const key = `${run.font}:${size}`;

      if (!inkBounds.has(key)) inkBounds.set(key, font(run.font, size).getMetrics().bounds);
      const bounds = inkBounds.get(key);

      if (!bounds) {
        composed.inkTop = -Infinity;
        composed.inkBottom = Infinity;
        break;
      }

      for (let i = 1; i < run.positions.length; i += 2) {
        composed.inkTop = Math.min(composed.inkTop, run.positions[i] + bounds[1]);
        composed.inkBottom = Math.max(composed.inkBottom, run.positions[i] + bounds[3]);
      }
    }
  }

  function snapshot(paragraphs: ComposedParagraph[], size: number, started: number): LaidOut {
    const document = placeParagraphs(paragraphs);
    stats.lines += document.lines.length;

    return {
      height: document.height,
      lines: document.lines,
      coreMs: performance.now() - started,
      adapterMs: 0,
      missing: 0,
      hit: document.hit,
      geometry: document.geometry,
      move: document.move,
      draw(canvas, x, y) {
        assertActive();

        for (const placement of document.placements)
          for (const run of placement.paragraph.runs) {
            canvas.drawGlyphs(
              run.glyphs,
              run.positions,
              x,
              y + placement.y,
              font(run.font, size),
              paint,
            );
          }
      },
      drawViewport(canvas, x, y, top, bottom) {
        assertActive();

        let paragraphsValue = 0,
          runs = 0;

        for (const placement of document.visible(top, bottom)) {
          paragraphsValue++;

          for (const run of placement.paragraph.runs) {
            canvas.drawGlyphs(
              run.glyphs,
              run.positions,
              x,
              y + placement.y,
              font(run.font, size),
              paint,
            );
            runs++;
          }
        }

        return { paragraphs: paragraphsValue, runs };
      },
      dispose() {},
    };
  }

  function createLayout() {
    assertActive();
    const documents = new Map<number, Map<string, RetainedParagraph>>();
    cacheScopes.add(documents);
    let released = false;

    function assertOwner() {
      assertActive();

      if (released) throw new Error('Layout owner is destroyed');
    }

    return {
      layout(input: LayoutInput): LaidOut {
        assertOwner();
        const started = performance.now();
        const size = input.size;

        if (
          !(
            input.width > 0 &&
            input.size > 0 &&
            Number.isFinite(input.width) &&
            Number.isFinite(input.size)
          )
        )
          throw new Error('Width and size must be positive finite numbers');

        if (!supportsOwnedText(input.text))
          throw new Error(
            'Owned prototype currently supports Latin left-to-right paragraphs and emoji.',
          );
        const allStops = new Set(input.spans.length ? boundaries(input.text) : []);

        for (const span of input.spans)
          if (!allStops.has(span.start) || !allStops.has(span.end))
            throw new Error('Formatting must end at grapheme boundaries');
        const paragraphs: ComposedParagraph[] = [];
        const previous = documents.get(input.id);
        const retained = new Map<string, RetainedParagraph>();
        let offset = 0;

        for (const text of input.text.split('\n')) {
          const spans = input.spans
            .filter((s) => s.end > offset && s.start < offset + text.length)
            .map((s) => ({
              ...s,
              start: Math.max(0, s.start - offset),
              end: Math.min(text.length, s.end - offset),
            }));

          const key = JSON.stringify([
            text,
            spans,
            input.size,
            input.lineHeight,
            input.baselineGrid,
          ]);

          const cached = retained.get(key) ?? previous?.get(key);

          const { paragraphGlyphs, composed, packed } = prepare(
            text,
            spans,
            input.width,
            input.size,
            cached,
            input.lineHeight,
            input.baselineGrid,
          );

          retained.set(key, { paragraphGlyphs, composed, packed });
          paragraphs.push(composed);
          stats.paragraphs++;
          offset += text.length + 1;
        }

        const result = snapshot(paragraphs, size, started);
        documents.set(input.id, retained);

        return result;
      },
      layoutInline(input: {
        id: number;
        text: string;
        spans: Span[];
        atoms: readonly InlineAtom[];
        width: number;
        size: number;
        lineHeight?: number;
        baselineGrid?: number;
      }) {
        assertOwner();
        const started = performance.now();

        if (
          !(
            input.width > 0 &&
            input.size > 0 &&
            Number.isFinite(input.width) &&
            Number.isFinite(input.size)
          )
        )
          throw new Error('Invalid inline layout dimensions');

        const key = JSON.stringify([
          input.text,
          input.spans,
          input.atoms,
          input.size,
          input.lineHeight,
          input.baselineGrid,
        ]);

        const previous = documents.get(input.id)?.get(key);

        const paragraphGlyphs =
          previous?.paragraphGlyphs ??
          layoutInlineParagraph(input.text, input.spans, input.atoms, (text, fontValue) =>
            resolveGlyphs(text, fontValue, input.size),
          );

        if (!('clusters' in paragraphGlyphs)) throw new Error('Inline cache kind mismatch');
        const packed = previous?.packed ?? packGlyphs(paragraphGlyphs);
        const fontMetrics = font(0, input.size).getMetrics();
        const defaultHeight = input.lineHeight ?? input.size * 1.6;

        const normalBaseline =
          (defaultHeight - (fontMetrics.descent - fontMetrics.ascent)) / 2 - fontMetrics.ascent;

        // This spike uses a common line height accommodating the tallest inline.
        const rawBaseline = Math.max(normalBaseline, ...input.atoms.map((a) => a.ascent));

        const baseline = input.baselineGrid
          ? Math.ceil(rawBaseline / input.baselineGrid) * input.baselineGrid
          : rawBaseline;

        const rawHeight =
          baseline + Math.max(defaultHeight - normalBaseline, ...input.atoms.map((a) => a.descent));

        const lineHeight = input.baselineGrid
          ? Math.ceil(rawHeight / input.baselineGrid) * input.baselineGrid
          : rawHeight;

        const composed =
          previous?.composed?.width === input.width
            ? previous.composed
            : composeParagraph(
                paragraphGlyphs,
                input.text.length,
                input.width,
                lineHeight,
                baseline,
                packed,
                'packed',
              );

        if (composed !== previous?.composed) {
          includeInkBounds(composed, input.size);
          stats.compositions++;
          stats.renderBuffers += composed.runs.length;
        }

        const result = snapshot([composed], input.size, started);

        const inlineBoxes = input.atoms.map((atom) => {
          const caret = composed.geometry(atom.index, atom.index, false).caret;
          const line = composed.lines.find((l) => l.top === caret[1]);

          if (!line) throw new Error('Missing inline line');

          return {
            ...atom,
            x: caret[0],
            y: line.baseline - atom.ascent,
            height: atom.ascent + atom.descent,
          };
        });

        documents.set(input.id, new Map([[key, { paragraphGlyphs, packed, composed }]]));

        return { ...result, inlineBoxes };
      },
      // Release when the owning document/block is removed, not when a rendered
      // LaidOut snapshot is disposed. Existing snapshots remain usable.
      release(id: number) {
        assertOwner();
        documents.delete(id);
      },
      // Published snapshots remain valid; only the engine's composition cache drops.
      releaseLayout(id: number) {
        assertOwner();
        const retained = documents.get(id);

        if (retained)
          for (const [key, paragraph] of retained) {
            retained.set(key, {
              paragraphGlyphs: paragraph.paragraphGlyphs,
              packed: paragraph.packed,
            });
          }
      },
      clear() {
        assertOwner();
        documents.clear();
      },
      destroy() {
        if (released) return;
        released = true;
        documents.clear();
        cacheScopes.delete(documents);
      },
    };
  }

  return {
    createLayout,
    layoutText(input: Omit<LayoutInput, 'id'>) {
      const owner = createLayout();

      try {
        return owner.layout({ ...input, id: 0 });
      } finally {
        owner.destroy();
      }
    },
    stats,
    wasmBytes: wasm.byteLength,
    createBlockDocument(settings: { width: number; size: number }) {
      assertActive();

      const session = createBlockSession<PreparedParagraph>(settings, {
        prepare,
        snapshot: (paragraphs, size, started) =>
          snapshot(
            paragraphs.map((p) => p.composed),
            size,
            started,
          ),
        validated(text) {
          stats.validatedBlocks++;
          stats.validatedCharacters += text.length;
        },
        closed() {
          blockSessions.delete(session);
        },
      });

      blockSessions.add(session);

      return {
        get blockCount() {
          return session.blockCount;
        },
        snapshot: session.snapshot,
        splice: session.splice,
        configure: session.configure,
        release: session.release,
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;

      for (const scope of cacheScopes) scope.clear();
      cacheScopes.clear();

      for (const session of blockSessions) session.release();

      for (const value of fonts.values()) value.delete();
      fonts.clear();

      for (const face of faces) face.delete();
      paint.delete();
      inkBounds.clear();
      paragraphMetrics.clear();
      runtime = undefined;
    },
    memory() {
      const paragraphs = [...cacheScopes]
        .flatMap((scope) => [...scope.values()])
        .flatMap((document) => [...document.values()])
        .concat([...blockSessions].flatMap((s) => s.retained()));

      const totals = {
        caretBufferBytes: 0,
        caretUsedBytes: 0,
        caretUnusedBytes: 0,
        caretCapacity: 0,
        caretCount: 0,
        lineCapacity: 0,
        lineCount: 0,
        glyphBufferBytes: 0,
        shapingBufferBytes: 0,
      };

      for (const paragraph of paragraphs) {
        if ('clusterStarts' in paragraph.paragraphGlyphs)
          totals.shapingBufferBytes += paragraph.paragraphGlyphs.bytes;

        if (!paragraph.composed) continue;
        const storageValue = paragraph.composed.storage();
        totals.caretBufferBytes += storageValue.caretBufferBytes;
        totals.caretUsedBytes += storageValue.caretUsedBytes;
        totals.caretUnusedBytes += storageValue.caretUnusedBytes;
        totals.caretCapacity += storageValue.caretCapacity;
        totals.caretCount += storageValue.caretCount;
        totals.lineCapacity += storageValue.lineCapacity;
        totals.lineCount += storageValue.lineCount;
        totals.glyphBufferBytes += storageValue.glyphBufferBytes;
      }

      return {
        ...totals,
        wasmLinearBytes: runtime?.memory.buffer.byteLength ?? 0,
        paragraphs: paragraphs.length,
        composedParagraphs: paragraphs.filter((p) => p.composed).length,
      };
    },
    retention() {
      return {
        owners: cacheScopes.size,
        documents:
          [...cacheScopes].reduce((sum, scope) => sum + scope.size, 0) + blockSessions.size,
        paragraphVariants:
          [...cacheScopes]
            .flatMap((scope) => [...scope.values()])
            .reduce((sum, paragraphs) => sum + paragraphs.size, 0) +
          [...blockSessions].reduce((sum, session) => sum + session.retained().length, 0),
      };
    },
  };
}
