import { checkOwnedViewport } from './owned-viewport';
import { checkOwnedBlocks } from './owned-block-checks';
import { createLargeSession } from './owned-large';
import './style.css';
import { createOwnedMemorySession } from './owned-memory';
import { benchmarkCaretQueries } from './owned-caret-queries';
import { createOwnedProfile } from './owned-profile';
import { validateOwnedSizes } from './owned-size-checks';
import { benchmarkOwnedStorage } from './owned-storage-benchmark';
import { checkOwnedPipeline } from './owned-pipeline-checks';
import { checkOwnedRetention } from './owned-retention-checks';
import { benchmarkOwned } from './owned-benchmark';
import { initialize, type Engine } from './engines';
import { createOwnedEngine } from './owned-layout';
import { boundaries } from './model';
function element<T extends HTMLElement>(id: string, kind: { new(): T }) { const value = document.getElementById(id); if (!(value instanceof kind)) throw new Error(id); return value; }
const input = element('input', HTMLTextAreaElement), width = element('width', HTMLInputElement), status = element('status', HTMLParagraphElement), host = element('panes', HTMLDivElement), results = element('results', HTMLPreElement);
input.value = 'An office full of affinity: efficient typography and café accents.\n\nThis paragraph stays cached when another paragraph changes. Resize the page width to reflow without reshaping.\nCombining accents: café. A long word: supercalifragilisticexpialidocious.';
async function start() {
  const standard = await initialize(), owned = await createOwnedEngine(standard.kit);
  const engines = [...standard.engines, owned.engine];
  const retained: import('./engines').LaidOut[] = [];
  function render() {
    retained.splice(0).forEach(layout => layout.dispose());
    host.replaceChildren();
    const before = { ...owned.stats };
    for (const engine of engines) {
      const section = document.createElement('section'), title = document.createElement('h2');
      title.textContent = engine.name; section.append(title); host.append(section);
      try {
        const layout = engine.layout({ id: 0, text: input.value, spans: [], width: Number(width.value), size: 20 });
        const canvas = document.createElement('canvas'); canvas.width = Number(width.value) + 24; canvas.height = Math.ceil(layout.height) + 24; section.append(canvas);
        const surface = standard.kit.MakeSWCanvasSurface(canvas);
        if (!surface) throw new Error('Canvas surface unavailable');
        const draw = surface.getCanvas(); draw.clear(standard.kit.WHITE);
        const paint = new standard.kit.Paint(); paint.setColor(standard.kit.Color(180, 210, 245));
        const geometry = layout.geometry(input.selectionStart, input.selectionEnd, false);
        for (const rect of geometry.rects) draw.drawRect(standard.kit.XYWHRect(rect[0] + 12, rect[1] + 12, rect[2] - rect[0], rect[3] - rect[1]), paint);
        layout.draw(draw, 12, 12);
        paint.setColor(standard.kit.Color(210, 50, 50)); const r = geometry.caret; draw.drawRect(standard.kit.XYWHRect(r[0] + 12, r[1] + 12, 1, r[3] - r[1]), paint);
        surface.flush(); surface.dispose(); paint.delete();
        canvas.onclick = e => { const rect = canvas.getBoundingClientRect(); const p = layout.hit(e.clientX - rect.left - 12, e.clientY - rect.top - 12); input.setSelectionRange(p.index, p.index); render(); };
        const timing = document.createElement('p'); timing.textContent = `${layout.lines.length} lines · ${layout.coreMs.toFixed(2)} ms layout`; section.append(timing);
        retained.push(layout);
      } catch (error) { const message = document.createElement('p'); message.textContent = String(error); section.append(message); }
    }
    status.textContent = 'Ready. The original editor remains at /.';
    results.textContent = JSON.stringify({ ownedWasmBytes: owned.wasmBytes, shapeCallsThisRender: owned.stats.shapeCalls - before.shapeCalls, cacheHitsThisRender: owned.stats.cacheHits - before.cacheHits, totals: owned.stats }, null, 2);
  }
  function audit() {
    const engine = owned.engine;
    function layout(text: string, w = 250, spans: Parameters<Engine['layout']>[0]['spans'] = []) { return engine.layout({ id: 1, text, spans, width: w, size: 20 }); }
    const checks: Record<string, boolean> = {};
    engine.clear();
    const text = 'The office has affinity.\nAnother independent paragraph.';
    layout(text); const initial = owned.stats.shapeCalls; layout(text, 180);
    checks.resizeWithoutShaping = owned.stats.shapeCalls === initial;
    layout(text.replace('The office', 'Our office'), 180);
    checks.editShapesOneParagraph = owned.stats.shapeCalls === initial + 1;
    for (const text of ['office', 'café', '', 'a\n\nb\n', 'supercalifragilisticexpialidocious']) {
      const result = layout(text, 80);
      checks[`caretRoundTrip:${text}`] = boundaries(text).every(index => { const c = result.geometry(index, index, false).caret; return result.hit(c[0], (c[1] + c[3]) / 2).index === index; });
      checks[`finite:${text}`] = result.lines.every(l => Number.isFinite(l.width) && l.end >= l.start);
    }
    const wrapped = layout('word word word word', 60); const boundary = wrapped.lines[0].end;
    checks.wrapAffinity = wrapped.geometry(boundary, boundary, true).caret[1] !== wrapped.geometry(boundary, boundary, false).caret[1];
    const ligature = layout('office'); checks.ligatureInterior = ligature.geometry(2, 2, false).caret[0] < ligature.geometry(3, 3, false).caret[0];
    checks.selection = ligature.geometry(1, 4, false).rects.length === 1;
    checks.navigation = ligature.move(2, false, 'right').index === 3 && ligature.move(3, false, 'left').index === 2 && ligature.move(3, false, 'home').index === 0 && ligature.move(3, false, 'end').index === 6;
    const accent = layout('café'); checks.accentNavigation = accent.move(3, false, 'right').index === 5;
    const reference = standard.engines[1].layout({ id: 3, text: 'office affinity café', spans: [], width: 450, size: 20 });
    const candidate = layout('office affinity café', 450);
    checks.referenceWidth = Math.abs(reference.lines[0].width - candidate.lines[0].width) < 0.1; reference.dispose();
    const styled = layout('bold italic', 250, [{ start: 0, end: 4, bold: true, italic: false }, { start: 5, end: 11, bold: false, italic: true }]); checks.styled = styled.lines[0].width > 0;
    for (const text of ['مرحبا', 'שלום', 'a\tb', '👨‍👩‍👧‍👦']) { try { layout(text); checks[`reject:${text}`] = false; } catch { checks[`reject:${text}`] = true; } }
    const timings: Record<string, number> = {}; const large = Array.from({ length: 500 }, (_, i) => `Paragraph ${i}: office affinity and a few words to wrap at this width.`).join('\n');
    for (const e of engines) { const t = performance.now(); const l = e.layout({ id: 2, text: large, spans: [], width: 450, size: 20 }); timings[e.name] = performance.now() - t; l.dispose(); }
    Object.assign(checks, checkOwnedRetention(owned), checkOwnedPipeline(owned, standard.kit));
    return { checks, timings, stats: { ...owned.stats }, wasmBytes: owned.wasmBytes };
  }
  Object.assign(window, { prepareOwnedLarge: async (storage: 'carets' | 'shaping', count: number, styled: boolean, api: 'whole' | 'blocks' = 'whole') => { Object.assign(window, { ownedLarge: await createLargeSession(standard.kit, storage, count, styled, api) }); }, prepareOwnedMemory: async (storage: 'objects' | 'carets' | 'shaping', count: number) => { Object.assign(window, { ownedMemory: await createOwnedMemorySession(standard.kit, storage, count) }); }, prepareOwnedProfile: async (comparison: 'packed' | 'carets' = 'packed') => { Object.assign(window, { ownedProfile: await createOwnedProfile(standard.kit, comparison) }); }, ownedSpike: { audit, checkViewport: () => checkOwnedViewport(standard.kit), checkBlocks: () => checkOwnedBlocks(standard.kit), validateShaping: () => validateOwnedSizes(standard.kit, standard.engines[1], 'shaping'), benchmarkShaping: () => benchmarkOwnedStorage(standard.kit, 'shaping'), benchmark: () => benchmarkOwned(engines, owned), validateCarets: () => validateOwnedSizes(standard.kit, standard.engines[1], 'carets'), validateSizes: () => validateOwnedSizes(standard.kit, standard.engines[1]), benchmarkCaretQueries: () => benchmarkCaretQueries(standard.kit), benchmarkCarets: () => benchmarkOwnedStorage(standard.kit, 'carets'), benchmarkStorage: () => benchmarkOwnedStorage(standard.kit) } });
  input.oninput = render; input.onselect = render; width.oninput = render; render();
}
start().catch(error => { status.textContent = String(error); });
