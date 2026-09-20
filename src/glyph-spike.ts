import "./style.css";
import {
  glyph,
  msdf,
  createFontStack,
  txt,
  span,
  GlyphEngineStatusError,
  glyphEngineStatusErrorDetails,
} from "@pmndrs/glyph";
import { ThreeConfig } from "@pmndrs/glyph/three";
import {
  Scene,
  OrthographicCamera,
  WebGPURenderer,
  Color,
  NoToneMapping,
} from "three/webgpu";
import { initialize, type LaidOut } from "./engines";
import { samples, boundaries, type Span } from "./model";

function get<T extends HTMLElement>(id: string, type: { new (): T }): T {
  const e = document.getElementById(id);
  if (!(e instanceof type)) throw new Error(`Missing ${id}`);
  return e;
}
const input = get("input", HTMLTextAreaElement),
  sample = get("sample", HTMLSelectElement),
  widthInput = get("width", HTMLSelectElement),
  sizeInput = get("size", HTMLSelectElement);
const status = get("status", HTMLParagraphElement),
  results = get("results", HTMLPreElement);
const fixtures = {
  prose: samples.prose,
  scripts: samples.scripts,
  ligatures: { text: "office affinity fi ffi café café 👨‍👩‍👧‍👦", spans: [] },
  bidi: { text: "English مرحبًا بالعالم — שלום עולם 09:35 English", spans: [] },
  empty: { text: "", spans: [] },
};
let text = samples.prose.text,
  styles: Span[] = samples.prose.spans;
let width = 600,
  size = 20;
input.value = text;
const startup: Record<string, number | string> = {};
const marks = performance.now();
async function start() {
  const standard = await initialize();
  startup.existingInitializeMs = performance.now() - marks;
  const fontNames = [
    "NotoSans-Regular",
    "NotoSans-Bold",
    "NotoSans-Italic",
    "NotoSans-BoldItalic",
    "NotoSansArabic-Regular",
    "NotoSansHebrew-Regular",
    "NotoSansDevanagari-Regular",
  ];
  const glyphStart = performance.now();
  await glyph.init();
  startup.glyphWasmMs = performance.now() - glyphStart;
  const handle = glyph.handle("gprose:spike", ThreeConfig);
  const faces = fontNames.map((name) =>
    glyph.fontFace(`/glyph-spike/${name}.glb`, { format: msdf }),
  );
  const fontStart = performance.now();
  await Promise.all(faces.map((f) => f.load()));
  startup.glyphFontsMs = performance.now() - fontStart;
  const fonts = faces.map((face) => {
    const probe = handle.createText({ font: face, text: "" });
    const selected = probe.font;
    const font = "fonts" in selected ? selected.fonts[0] : selected;
    // Keep the owner text alive: its selected font lease ends at dispose().
    return font;
  });
  const stacks = fonts
    .slice(0, 4)
    .map((font) => createFontStack(font, ...fonts.slice(4)));
  const panes = ["CanvasKit", "Parley", "Glyph"].map((name) => {
    const section = document.createElement("section");
    section.className = "pane";
    section.style.flex = "0 0 auto";
    section.dataset.engine = name;
    const heading = document.createElement("h2");
    heading.textContent = name;
    heading.style.padding = "12px";
    const host = document.createElement("div");
    host.style.position = "relative";
    const canvas = document.createElement("canvas"),
      overlay = document.createElement("canvas");
    overlay.style.cssText =
      "position:absolute;left:0;top:0;pointer-events:none";
    host.append(canvas, overlay);
    section.append(heading, host);
    get("panes", HTMLDivElement).append(section);
    return { name, section, canvas, overlay };
  });
  const rendererStart = performance.now();
  const renderer = new WebGPURenderer({
    canvas: panes[2].canvas,
    antialias: true,
    forceWebGL:
      new URLSearchParams(location.search).get("backend") !== "webgpu",
  });
  renderer.setClearColor(new Color("white"));
  renderer.toneMapping = NoToneMapping;
  await renderer.init();
  startup.glyphRendererInitMs = performance.now() - rendererStart;
  startup.backendActual =
    "isWebGPUBackend" in renderer.backend &&
    renderer.backend.isWebGPUBackend === true
      ? "WebGPU"
      : "WebGL2";
  startup.backendRequested =
    new URLSearchParams(location.search).get("backend") === "webgpu"
      ? "WebGPU (fallback allowed)"
      : "WebGL2";
  const scene = new Scene(),
    camera = new OrthographicCamera(0, width + 48, 0, -560, 0.1, 1000);
  camera.position.z = 10;
  const label = handle.createText({
    font: stacks[0],
    text,
    style: { fontSize: size, lineHeight: 1.6, color: "#252a23" },
    constraints: { width: { mode: "exact", size: width } },
  });
  label.position.set(24, -24, 0);
  scene.add(label);
  let layouts: LaidOut[] = [],
    surfaces = panes
      .slice(0, 2)
      .map(() =>
        standard.kit.MakeSWCanvasSurface(document.createElement("canvas")),
      );
  function formatted() {
    const cuts = [
      ...new Set([0, text.length, ...styles.flatMap((s) => [s.start, s.end])]),
    ].sort((a, b) => a - b);
    let value = txt`${span(stacks[0])``}`;
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i],
        b = cuts[i + 1],
        selected = styles.filter((s) => s.start <= a && s.end >= b);
      const index =
        (selected.some((s) => s.bold) ? 1 : 0) +
        (selected.some((s) => s.italic) ? 2 : 0);
      value = txt`${value}${span(stacks[index])`${text.slice(a, b)}`}`;
    }
    return value;
  }
  function shapeGlyph() {
    label.set({
      text: styles.length ? formatted() : text,
      style: { fontSize: size, lineHeight: 1.6, color: "#252a23" },
      constraints: { width: { mode: "exact", size: width } },
    });
    glyph.shape();
    return label.glyphs();
  }
  function paintSelection() {
    const a = input.selectionStart,
      b = input.selectionEnd;
    panes.forEach((pane, i) => {
      const c = pane.overlay.getContext("2d");
      if (!c) return;
      c.clearRect(0, 0, pane.overlay.width, pane.overlay.height);
      c.save();
      c.scale(devicePixelRatio, devicePixelRatio);
      c.translate(24, 24);
      c.fillStyle = "rgba(110,155,60,.25)";
      const boxes =
        i === 2
          ? (label.selectionRects(a, b) ?? []).map((r) => [
              r.x,
              r.y,
              r.x + r.width,
              r.y + r.height,
            ])
          : layouts[i].geometry(a, b, false).rects;
      boxes.forEach((r) => c.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]));
      c.restore();
    });
  }
  function update() {
    width = Number(widthInput.value);
    size = Number(sizeInput.value);
    layouts.forEach((l) => l.dispose());
    layouts = standard.engines.map((e) =>
      e.layout({ id: 900000, text, spans: styles, width, size }),
    );
    const g = shapeGlyph();
    const height = Math.max(
      300,
      Math.min(1800, Math.max(g.height, ...layouts.map((l) => l.height)) + 48),
    );
    panes.forEach((p) => {
      p.section.style.width = `${width + 48}px`;
      for (const canvas of [p.canvas, p.overlay]) {
        canvas.width = Math.round((width + 48) * devicePixelRatio);
        canvas.height = Math.round(height * devicePixelRatio);
        canvas.style.width = `${width + 48}px`;
        canvas.style.height = `${height}px`;
      }
    });
    surfaces.forEach((s) => s?.delete());
    surfaces = panes
      .slice(0, 2)
      .map(
        (p) =>
          standard.kit.MakeWebGLCanvasSurface(p.canvas) ??
          standard.kit.MakeSWCanvasSurface(p.canvas),
      );
    surfaces.forEach((s, i) => {
      if (!s) throw new Error("Skia surface unavailable");
      const c = s.getCanvas();
      c.clear(standard.kit.WHITE);
      c.scale(devicePixelRatio, devicePixelRatio);
      layouts[i].draw(c, 24, 24);
      s.flush();
    });
    renderer.setPixelRatio(devicePixelRatio);
    renderer.setSize(width + 48, height, false);
    camera.right = width + 48;
    camera.bottom = -height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    paintSelection();
    status.textContent = `Ready · Glyph ${g.lineCount} lines / ${g.missingGlyphCount} missing glyphs · ${startup.backendActual}`;
    return g;
  }
  input.oninput = () => {
    text = input.value;
    styles = [];
    update();
  };
  input.onselect = paintSelection;
  sample.onchange = () => {
    const value = Object.entries(fixtures).find(
      ([name]) => name === sample.value,
    )?.[1];
    if (!value) return;
    text = value.text;
    styles = value.spans;
    input.value = text;
    update();
  };
  widthInput.onchange = sizeInput.onchange = () => update();
  panes.forEach(
    (pane, i) =>
      (pane.canvas.onpointerdown = (e) => {
        const box = pane.canvas.getBoundingClientRect(),
          x = e.clientX - box.left - 24,
          y = e.clientY - box.top - 24;
        const index =
          i === 2
            ? (label.caretAt(x, y)?.offset ?? 0)
            : layouts[i].hit(x, y).index;
        input.focus({ preventScroll: true });
        input.setSelectionRange(index, index);
        paintSelection();
        status.textContent = `${pane.name} native hit → UTF-16 ${index} · grapheme boundary: ${boundaries(text).includes(index)}`;
      }),
  );
  function inspect() {
    const g = label.glyphs();
    const points = Array.from({ length: Math.max(1, g.lineCount) }, (_, line) =>
      Array.from({ length: text.length < 100 ? 1201 : 41 }, (_, i) => ({
        x: (i * width) / (text.length < 100 ? 1200 : 40),
        y: g.lineBaselines[line] - size / 2,
      })),
    ).flat();
    const stops = boundaries(text),
      hits = points.map((p) => ({
        ...p,
        offset: label.caretAt(p.x, p.y)?.offset ?? 0,
      }));
    const offsets = [...new Set(hits.map((h) => h.offset))].sort(
      (a, b) => a - b,
    );
    return {
      text,
      width,
      size,
      glyph: {
        lines: g.lineCount,
        missing: g.missingGlyphCount,
        clusters: [...g.clusters],
        hitOffsets: offsets,
        nonGraphemeHits: hits.filter((h) => !stops.includes(h.offset)),
        selection: label.selectionRects(0, text.length),
        gpuBytes: label.gpuBytes,
      },
      existing: layouts.map((l, i) => ({
        name: standard.engines[i].name,
        lines: l.lines.length,
        missing: l.missing,
      })),
      startup,
    };
  }
  function lifecycleProbe() {
    try {
      for (let round = 0; round < 2; round++) {
        const probe = handle.createText({
          font: stacks[0],
          text: round % 2 ? samples.prose.text.repeat(32) : samples.prose.text,
          style: { fontSize: size },
          constraints: { width: { mode: "exact", size: width } },
        });
        scene.add(probe);
        glyph.shape();
        probe.glyphs();
        probe.removeFromParent();
        probe.dispose();
        glyph.shape();
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: String(error),
        details:
          error instanceof GlyphEngineStatusError
            ? {
                code: error.statusCode,
                ...glyphEngineStatusErrorDetails(error),
              }
            : null,
      };
    }
  }
  let lastRun: unknown;
  async function measure() {
    const saved = { text, styles };
    const records = [];
    for (const [name, value] of Object.entries(fixtures)) {
      text = value.text;
      styles = value.spans;
      input.value = text;
      update();
      records.push({ fixture: name, ...inspect() });
    }
    const scenarios = [
      { name: "short", value: samples.prose.text },
      {
        name: "long-paragraph",
        value: Array(32).fill(samples.prose.text).join("\n"),
      },
    ];
    const timings: {
      scenario: string;
      operation: string;
      utf16: number;
      includes: string;
      values: {
        engine: string;
        medianMs: number | undefined;
        samples: number[];
      }[];
    }[] = [];
    const failures: unknown[] = [];
    lastRun = { records, timings, failures };
    for (const scenario of scenarios) {
      text = scenario.value;
      styles = [];
      input.value = text;
      update();
      for (const operation of ["edit", "resize"] as const) {
        const times = [[], [], []] as number[][];
        for (let round = 0; round < 24; round++) {
          text =
            scenario.value + (operation === "edit" && round % 2 ? "x" : "");
          const w = operation === "resize" ? (round % 2 ? 300 : 600) : 600;
          width = w;
          for (const i of [round % 3, (round + 1) % 3, (round + 2) % 3]) {
            const start = performance.now();
            try {
              if (i < 2) {
                const l = standard.engines[i].layout({
                  id: 900001,
                  text,
                  spans: [],
                  width: w,
                  size,
                });
                l.geometry(0, text.length, false);
                l.dispose();
              } else {
                shapeGlyph();
                label.selectionRects(0, text.length);
              }
              if (round >= 4) times[i].push(performance.now() - start);
            } catch (error) {
              failures.push({
                scenario: scenario.name,
                operation,
                round,
                engine: panes[i].name,
                error: String(error),
                details:
                  error instanceof GlyphEngineStatusError
                    ? {
                        code: error.statusCode,
                        ...glyphEngineStatusErrorDetails(error),
                      }
                    : null,
              });
              break;
            }
          }
          if (round % 4 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        timings.push({
          scenario: scenario.name,
          operation,
          utf16: scenario.value.length,
          includes:
            "synchronous update + full selection query; excludes draw and GPU",
          values: times.map((values, i) => ({
            engine: panes[i].name,
            medianMs: [...values].sort((a, b) => a - b)[
              Math.floor(values.length / 2)
            ],
            samples: values,
          })),
        });
      }
    }
    text = saved.text;
    styles = saved.styles;
    input.value = text;
    update();
    const drawSubmission = panes.map((pane, i) => {
      const values: number[] = [];
      for (let round = 0; round < 24; round++) {
        const started = performance.now();
        if (i === 2) renderer.render(scene, camera);
        else {
          const surface = surfaces[i];
          if (surface) {
            const c = surface.getCanvas();
            c.clear(standard.kit.WHITE);
            layouts[i].draw(c, 24, 24);
            surface.flush();
          }
        }
        if (round >= 4) values.push(performance.now() - started);
      }
      return {
        engine: pane.name,
        medianMs: [...values].sort((a, b) => a - b)[10],
        samples: values,
      };
    });
    const report = {
      failures,
      drawSubmission,
      version: "@pmndrs/glyph@0.1.0",
      startup,
      records,
      timings,
    };
    results.textContent = JSON.stringify(report, null, 2);
    return report;
  }
  get("measure", HTMLButtonElement).onclick = () => {
    get("measure", HTMLButtonElement).disabled = true;
    measure()
      .catch((e) => {
        results.textContent = String(e);
      })
      .finally(() => (get("measure", HTMLButtonElement).disabled = false));
  };
  update();
  startup.readyMs = performance.now() - marks;
  Object.defineProperty(window, "glyphSpike", {
    value: { inspect, measure, lifecycleProbe, partial: () => lastRun },
  });
  document.documentElement.dataset.ready = "true";
}
start().catch((e) => {
  status.textContent = String(e);
  document.documentElement.dataset.ready = "error";
  console.error(e);
});
