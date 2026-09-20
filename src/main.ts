import "./style.css";
import { layoutAtom, registerImage, retainImages } from "./blocks";
import type { CanvasKit, Surface } from "canvaskit-wasm";
import { initialize, type Engine, type LaidOut, type Rect } from "./engines";
import {
  boundaries,
  format,
  nearestBoundary,
  paragraphs,
  reconcile,
  replace,
  samples,
  toggleBlock,
  indent,
  enter,
  insertAtom,
  leafAt,
  type Direction,
  type Document,
  type Selection,
} from "./model";

function element<T extends HTMLElement>(
  selector: string,
  constructor: { new (): T },
): T {
  const found = document.querySelector(selector);
  if (!(found instanceof constructor)) throw new Error(`Missing ${selector}`);
  return found;
}
const editors = element("#editors", HTMLDivElement);
const loading = element("#loading", HTMLDivElement);
const sample = element("#sample", HTMLSelectElement);
const sizeInput = element("#size", HTMLSelectElement);
const boundsInput = element("#geometry", HTMLInputElement);
const benchmarkButton = element("#benchmark", HTMLButtonElement);
let doc: Document = samples.structured;
sample.value = "structured";
let selection: Selection = { anchor: 0, focus: 0, upstream: false };
let size = 20;
let active: Pane | null = null;
let composing = false;
let panes: Pane[] = [];
const undo: { doc: Document; selection: Selection }[] = [];
const redo: typeof undo = [];

function checkpoint() {
  undo.push({ doc, selection: { ...selection } });
  if (undo.length > 100) undo.shift();
  redo.length = 0;
}
function render() {
  retainImages(
    new Set(
      [doc, ...undo.map((s) => s.doc), ...redo.map((s) => s.doc)].flatMap((d) =>
        d.leaves.flatMap((p) =>
          p.block.kind === "image" ? [p.block.source] : [],
        ),
      ),
    ),
  );
  for (const pane of panes) pane.update();
  element("#selection-status", HTMLSpanElement).textContent =
    selection.anchor === selection.focus
      ? `Caret ${selection.focus} · ${active?.engine.name ?? "click a pane to write"}`
      : `${Math.abs(selection.focus - selection.anchor)} UTF-16 units selected · ${Math.min(selection.anchor, selection.focus)}–${Math.max(selection.anchor, selection.focus)}`;
  element("#document-status", HTMLSpanElement).textContent =
    `${doc.text.length.toLocaleString()} UTF-16 units · ${doc.leaves.length} blocks`;
  const leaf = leafAt(doc, selection.focus);
  const selectedAtom = doc.leaves.find(
    (p) =>
      p.block.kind !== "paragraph" &&
      Math.min(selection.anchor, selection.focus) === p.start &&
      Math.max(selection.anchor, selection.focus) === p.start + 1,
  );
  element("#atom-actions", HTMLSpanElement).hidden = !selectedAtom;
  const open = element("#open-embed", HTMLAnchorElement);
  open.hidden = selectedAtom?.block.kind !== "embed";
  if (selectedAtom?.block.kind === "embed") open.href = selectedAtom.block.url;
  element("#indent", HTMLButtonElement).disabled = leaf.item === null;
  element("#outdent", HTMLButtonElement).disabled = leaf.item === null;
  element("#quote", HTMLButtonElement).setAttribute(
    "aria-pressed",
    String(leaf.quotes.length > 0),
  );
  for (const kind of ["bullet", "number"] as const)
    element(`#${kind}`, HTMLButtonElement).setAttribute(
      "aria-pressed",
      String(kind === "bullet" ? leaf.marker === "•" : /\d/.test(leaf.marker)),
    );
  element("#undo", HTMLButtonElement).disabled = !undo.length;
  element("#redo", HTMLButtonElement).disabled = !redo.length;
}
function history(back: boolean) {
  if (composing) return;
  const from = back ? undo : redo,
    to = back ? redo : undo;
  const next = from.pop();
  if (!next) return;
  to.push({ doc, selection: { ...selection } });
  doc = next.doc;
  selection = next.selection;
  render();
  (active ?? panes[0])?.focus();
  active?.reveal();
}
function applyFormat(key: "bold" | "italic") {
  if (composing) return;
  if (selection.anchor !== selection.focus) {
    checkpoint();
    doc = format(
      doc,
      Math.min(selection.anchor, selection.focus),
      Math.max(selection.anchor, selection.focus),
      key,
    );
    render();
  }
  (active ?? panes[0])?.focus();
}
for (const key of ["bold", "italic"] as const) {
  const button = element(`#${key}`, HTMLButtonElement);
  button.addEventListener("mousedown", (e) => e.preventDefault());
  button.addEventListener("click", () => applyFormat(key));
}
element("#undo", HTMLButtonElement).onclick = () => history(true);
element("#redo", HTMLButtonElement).onclick = () => history(false);
sizeInput.onchange = () => {
  size = Number(sizeInput.value);
  render();
};
boundsInput.onchange = () => panes.forEach((p) => p.paint());
sample.onchange = () => {
  if (composing) return;
  doc = samples[sample.value];
  selection = { anchor: 0, focus: 0, upstream: false };
  undo.length = 0;
  redo.length = 0;
  for (const p of panes) {
    p.clear();
    p.scroller.scrollTop = 0;
  }
  render();
};

function applyStructure(change: () => Document) {
  if (composing) return;
  const next = change();
  if (next === doc) return;
  checkpoint();
  doc = next;
  selection = {
    ...selection,
    anchor: Math.min(selection.anchor, doc.text.length),
    focus: Math.min(selection.focus, doc.text.length),
  };
  render();
  (active ?? panes[0])?.focus();
  active?.reveal();
}
for (const kind of ["bullet", "number", "quote"] as const) {
  const button = element(`#${kind}`, HTMLButtonElement);
  button.onmousedown = (e) => e.preventDefault();
  button.onclick = () =>
    applyStructure(() => toggleBlock(doc, selection, kind));
}
for (const outdent of [false, true]) {
  const button = element(outdent ? "#outdent" : "#indent", HTMLButtonElement);
  button.onmousedown = (e) => e.preventDefault();
  button.onclick = () => applyStructure(() => indent(doc, selection, outdent));
}
element("#remove-atom", HTMLButtonElement).onclick = () =>
  applyStructure(() =>
    replace(
      doc,
      Math.min(selection.anchor, selection.focus),
      Math.max(selection.anchor, selection.focus),
      "",
    ),
  );
for (const kind of ["image", "embed"] as const) {
  element(`#${kind}`, HTMLButtonElement).onclick = () => {
    if (composing) return;
    element(`#${kind}-dialog`, HTMLDialogElement).showModal();
  };
}
for (const button of document.querySelectorAll("[data-close]")) {
  if (button instanceof HTMLButtonElement)
    button.onclick = () => {
      element(`#${button.dataset.close}`, HTMLDialogElement).close();
      (active ?? panes[0])?.focus();
    };
}
function commitAtom(atom: Parameters<typeof insertAtom>[2]) {
  checkpoint();
  const result = insertAtom(doc, selection, atom);
  doc = result.doc;
  selection = {
    anchor: result.index,
    focus: result.index + 1,
    upstream: false,
  };
  render();
  (active ?? panes[0])?.focus();
  active?.reveal();
}
element("#embed-form", HTMLFormElement).onsubmit = (e) => {
  e.preventDefault();
  const form = element("#embed-form", HTMLFormElement),
    data = new FormData(form);
  const title = String(data.get("title")).trim(),
    url = new URL(String(data.get("url")));
  if (!["http:", "https:"].includes(url.protocol) || !title) {
    element("#embed-error", HTMLParagraphElement).textContent =
      "Enter a title and an http or https URL.";
    return;
  }
  commitAtom({ kind: "embed", title, url: url.href });
  element("#embed-dialog", HTMLDialogElement).close();
  form.reset();
  (active ?? panes[0])?.focus();
};
element("#image-form", HTMLFormElement).onsubmit = async (e) => {
  e.preventDefault();
  const form = element("#image-form", HTMLFormElement),
    data = new FormData(form),
    file = data.get("file");
  const title = String(data.get("title")).trim();
  if (!(file instanceof File) || !title || !panes.length) return;
  const submit = form.querySelector("button[type=submit]");
  if (submit instanceof HTMLButtonElement) submit.disabled = true;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const source = crypto.randomUUID();
    const dimensions = registerImage(panes[0].kit, source, bytes);
    commitAtom({ kind: "image", title, source, ...dimensions });
    element("#image-dialog", HTMLDialogElement).close();
    form.reset();
    (active ?? panes[0])?.focus();
  } catch (error) {
    element("#image-error", HTMLParagraphElement).textContent =
      error instanceof Error ? error.message : "Image could not be loaded.";
  } finally {
    if (submit instanceof HTMLButtonElement) submit.disabled = false;
  }
};

type Placed = ReturnType<typeof paragraphs>[number] & {
  top: number;
  left: number;
  contentWidth: number;
  markerLayout: LaidOut | null;
  layout: LaidOut;
};
class Pane {
  root = document.createElement("section");
  scroller = document.createElement("div");
  spacer = document.createElement("div");
  canvas = document.createElement("canvas");
  input = document.createElement("textarea");
  footer = document.createElement("div");
  placed: Placed[] = [];
  cache = new Map<number, { key: string; layout: LaidOut }>();
  markers = new Map<number, { key: string; layout: LaidOut }>();
  surface: Surface | null = null;
  width = 0;
  height = 0;
  dpr = 0;
  drawMs = 0;
  layoutMs = 0;
  adapterMs = 0;
  dragging = false;
  constructor(
    public kit: CanvasKit,
    public engine: Engine,
  ) {
    this.root.className = "pane";
    this.root.dataset.engine = engine.name;
    const header = document.createElement("div");
    header.className = "pane-header";
    header.innerHTML = `<h2>${engine.name}<small>${engine.name === "CanvasKit" ? "SkParagraph · 0.42.0" : "Rust / WASM · 0.11.1"}</small></h2><span class="active-label">Editing here</span>`;
    this.scroller.className = "scroller";
    this.spacer.className = "spacer";
    this.canvas.className = "canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.input.className = "input";
    this.input.setAttribute("aria-label", `${engine.name} editor`);
    this.input.spellcheck = false;
    this.input.autocapitalize = "off";
    this.input.autocomplete = "off";
    this.input.wrap = "off";
    this.footer.className = "pane-footer";
    this.spacer.append(this.canvas, this.input);
    this.scroller.append(this.spacer);
    this.root.append(header, this.scroller, this.footer);
    editors.append(this.root);
    this.input.addEventListener("focus", () => {
      active = this;
      panes.forEach((p) => p.root.classList.toggle("active", p === this));
      this.paint();
    });
    this.input.addEventListener("input", () => {
      if (!composing) checkpoint();
      doc = reconcile(doc, this.input.value);
      this.readSelection();
      render();
      this.reveal();
    });
    this.input.addEventListener("beforeinput", (e) => {
      if (
        !composing &&
        !e.isComposing &&
        ["insertLineBreak", "insertParagraph"].includes(e.inputType)
      ) {
        e.preventDefault();
        checkpoint();
        const result = enter(doc, selection);
        doc = result.doc;
        selection = {
          anchor: result.index,
          focus: result.index,
          upstream: false,
        };
        render();
        this.reveal();
        return;
      }
      const leaf = leafAt(doc, selection.focus);
      if (
        !composing &&
        !e.isComposing &&
        selection.anchor === selection.focus
      ) {
        const index = doc.leaves.indexOf(leaf);
        const adjacent =
          e.inputType === "deleteContentBackward" &&
          selection.focus === leaf.start
            ? doc.leaves[index - 1]
            : e.inputType === "deleteContentForward" &&
                selection.focus === leaf.start + leaf.text.length
              ? doc.leaves[index + 1]
              : null;
        if (adjacent && adjacent.block.kind !== "paragraph") {
          e.preventDefault();
          selection = {
            anchor: adjacent.start,
            focus: adjacent.start + 1,
            upstream: false,
          };
          render();
          this.reveal();
          return;
        }
      }
      if (
        !composing &&
        e.inputType === "deleteContentBackward" &&
        selection.anchor === selection.focus &&
        selection.focus === leaf.start &&
        leaf.item !== null
      ) {
        e.preventDefault();
        checkpoint();
        doc = indent(doc, selection, true);
        render();
        this.reveal();
        return;
      }
      if (
        composing ||
        e.isComposing ||
        !["deleteContentBackward", "deleteContentForward"].includes(e.inputType)
      )
        return;
      e.preventDefault();
      let start = Math.min(selection.anchor, selection.focus),
        end = Math.max(selection.anchor, selection.focus);
      if (start === end) {
        const stops = boundaries(doc.text);
        if (e.inputType === "deleteContentBackward")
          start = stops.filter((i) => i < start).at(-1) ?? 0;
        else end = stops.find((i) => i > end) ?? doc.text.length;
      }
      if (start === end) return;
      checkpoint();
      doc = replace(doc, start, end, "");
      const index = Math.min(start, doc.text.length);
      selection = { anchor: index, focus: index, upstream: false };
      render();
      this.reveal();
    });
    this.input.addEventListener("select", () => {
      if (document.activeElement !== this.input || composing) return;
      const a =
        this.input.selectionDirection === "backward"
          ? this.input.selectionEnd
          : this.input.selectionStart;
      const f =
        this.input.selectionDirection === "backward"
          ? this.input.selectionStart
          : this.input.selectionEnd;
      if (a !== selection.anchor || f !== selection.focus) {
        this.readSelection();
        render();
      }
    });
    this.input.addEventListener("compositionstart", () => {
      checkpoint();
      composing = true;
      sample.disabled = true;
      sizeInput.disabled = true;
      benchmarkButton.disabled = true;
    });
    this.input.addEventListener("compositionend", () => {
      // Some browsers dispatch the final input after compositionend.
      queueMicrotask(() => {
        doc = reconcile(doc, this.input.value);
        this.readSelection();
        composing = false;
        sample.disabled = false;
        sizeInput.disabled = false;
        benchmarkButton.disabled = false;
        render();
      });
    });
    this.input.addEventListener("keydown", (e) => this.key(e));
    this.canvas.addEventListener("pointerdown", (e) => {
      if (composing) return;
      e.preventDefault();
      active = this;
      this.focus();
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      const pos = this.hit(e.clientX, e.clientY);
      const leaf = leafAt(doc, pos.index);
      if (leaf.block.kind !== "paragraph" && !e.shiftKey) {
        selection = {
          anchor: leaf.start,
          focus: leaf.start + 1,
          upstream: false,
        };
        render();
        return;
      }
      selection = {
        anchor: e.shiftKey ? selection.anchor : pos.index,
        focus: pos.index,
        upstream: pos.upstream,
      };
      render();
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const rect = this.scroller.getBoundingClientRect();
      if (e.clientY < rect.top + 16) this.scroller.scrollTop -= 18;
      if (e.clientY > rect.bottom - 16) this.scroller.scrollTop += 18;
      const pos = this.hit(e.clientX, e.clientY);
      selection = { ...selection, focus: pos.index, upstream: pos.upstream };
      render();
    });
    this.canvas.addEventListener("pointerup", () => {
      this.dragging = false;
    });
    this.canvas.addEventListener("pointercancel", () => {
      this.dragging = false;
    });
    this.canvas.addEventListener("dblclick", (e) => {
      const pos = this.hit(e.clientX, e.clientY);
      const word = [
        ...new Intl.Segmenter(undefined, { granularity: "word" }).segment(
          doc.text,
        ),
      ].find(
        (s) => s.index <= pos.index && s.index + s.segment.length > pos.index,
      );
      if (word) {
        selection = {
          anchor: word.index,
          focus: word.index + word.segment.length,
          upstream: true,
        };
        render();
      }
    });
    this.scroller.addEventListener("scroll", () => this.paint(), {
      passive: true,
    });
    new ResizeObserver(() => this.update()).observe(this.scroller);
  }
  readSelection() {
    const reverse = this.input.selectionDirection === "backward";
    selection = {
      anchor: Math.min(
        doc.text.length,
        reverse ? this.input.selectionEnd : this.input.selectionStart,
      ),
      focus: Math.min(
        doc.text.length,
        reverse ? this.input.selectionStart : this.input.selectionEnd,
      ),
      upstream: false,
    };
  }
  focus() {
    this.syncInput();
    this.input.focus({ preventScroll: true });
  }
  syncInput() {
    if (composing && active === this) return;
    if (this.input.value !== doc.text) this.input.value = doc.text;
    const start = Math.min(selection.anchor, selection.focus),
      end = Math.max(selection.anchor, selection.focus);
    if (
      this.input.selectionStart !== start ||
      this.input.selectionEnd !== end ||
      this.input.selectionDirection !==
        (selection.focus < selection.anchor ? "backward" : "forward")
    )
      this.input.setSelectionRange(
        start,
        end,
        selection.focus < selection.anchor ? "backward" : "forward",
      );
  }
  clear() {
    for (const c of this.cache.values()) c.layout.dispose();
    this.cache.clear();
    for (const m of this.markers.values()) m.layout.dispose();
    this.markers.clear();
    this.engine.clear();
  }
  update() {
    const width = this.scroller.clientWidth,
      height = this.scroller.clientHeight,
      dpr = window.devicePixelRatio;
    if (!width || !height) return;
    if (width !== this.width || height !== this.height || dpr !== this.dpr) {
      this.surface?.delete();
      this.width = width;
      this.height = height;
      this.dpr = dpr;
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      this.surface =
        this.kit.MakeWebGLCanvasSurface(this.canvas) ??
        this.kit.MakeSWCanvasSurface(this.canvas);
      if (!this.surface)
        throw new Error("Could not create Skia drawing surface");
    }
    let top = 32,
      core = 0,
      adapter = 0,
      changed = false;
    const next = paragraphs(doc);
    this.placed = next.map((p) => {
      const left = 32 + p.depth * 28 + p.quotes.length * 22;
      const width = Math.max(
        40,
        Math.min(...panes.map((p) => p.scroller.clientWidth)) - 32 - left,
      );
      const key = JSON.stringify([p.block, width, size]);
      let cached = this.cache.get(p.id);
      if (!cached || cached.key !== key) {
        cached?.layout.dispose();
        const layout =
          p.block.kind === "paragraph"
            ? this.engine.layout({ ...p, width, size })
            : layoutAtom(this.kit, this.engine, p.block, width, size);
        cached = { key, layout };
        this.cache.set(p.id, cached);
        core += layout.coreMs;
        adapter += layout.adapterMs;
        changed = true;
      }
      const markerKey = JSON.stringify([p.marker, size]);
      let marker = this.markers.get(p.id);
      if (marker?.key !== markerKey) {
        marker?.layout.dispose();
        this.markers.delete(p.id);
        marker = undefined;
        if (p.marker) {
          marker = {
            key: markerKey,
            layout: this.engine.layout({
              id: 2000000 + p.id,
              text: p.marker,
              spans: [],
              width: 50,
              size,
            }),
          };
          this.markers.set(p.id, marker);
        }
      }
      const markerLayout = marker?.layout ?? null;
      const result = {
        ...p,
        top,
        left,
        contentWidth: width,
        markerLayout,
        layout: cached.layout,
      };
      top += cached.layout.height + 20;
      return result;
    });
    for (const [id, c] of this.cache)
      if (!next.some((p) => p.id === id)) {
        c.layout.dispose();
        this.cache.delete(id);
      }
    for (const [id, marker] of this.markers)
      if (!next.some((p) => p.id === id)) {
        marker.layout.dispose();
        this.markers.delete(id);
      }
    if (changed) {
      this.layoutMs = core;
      this.adapterMs = adapter;
    }
    this.spacer.style.height = `${Math.max(this.height, top + 12)}px`;
    this.syncInput();
    this.paint();
  }
  current() {
    return (
      this.placed.find(
        (p) =>
          selection.focus >= p.start &&
          selection.focus <= p.start + p.text.length,
      ) ?? this.placed[this.placed.length - 1]
    );
  }
  reveal() {
    const p = this.current();
    if (!p) return;
    const r = p.layout.geometry(
      selection.focus - p.start,
      selection.focus - p.start,
      selection.upstream,
    ).caret;
    const top = p.top + r[1],
      bottom = p.top + r[3];
    if (top < this.scroller.scrollTop + 12) this.scroller.scrollTop = top - 12;
    if (bottom > this.scroller.scrollTop + this.height - 12)
      this.scroller.scrollTop = bottom - this.height + 12;
    this.paint();
  }
  hit(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left - 32,
      y = clientY - rect.top + this.scroller.scrollTop;
    const p =
      this.placed.find((p) => y < p.top + p.layout.height + 10) ??
      this.placed[this.placed.length - 1];
    const pos = p.layout.hit(x - (p.left - 32), y - p.top);
    return { ...pos, index: p.start + nearestBoundary(p.text, pos.index) };
  }
  paint() {
    if (!this.surface) return;
    const started = performance.now(),
      canvas = this.surface.getCanvas(),
      kit = this.kit,
      scroll = this.scroller.scrollTop;
    canvas.clear(kit.WHITE);
    canvas.save();
    canvas.scale(this.dpr, this.dpr);
    const fill = new kit.Paint();
    fill.setAntiAlias(true);
    const drawRect = (r: Rect, x: number, y: number, color: Float32Array) => {
      fill.setColor(color);
      canvas.drawRect(
        kit.LTRBRect(r[0] + x, r[1] + y, r[2] + x, r[3] + y),
        fill,
      );
    };
    const a = Math.min(selection.anchor, selection.focus),
      b = Math.max(selection.anchor, selection.focus);
    for (const p of this.placed) {
      const y = p.top - scroll;
      if (y + p.layout.height < 0 || y > this.height) continue;
      const next = this.placed[this.placed.indexOf(p) + 1];
      for (let q = 0; q < p.quotes.length; q++)
        drawRect(
          [
            0,
            0,
            3,
            p.layout.height + (next?.quotes.includes(p.quotes[q]) ? 20 : 0),
          ],
          32 + q * 22,
          y,
          kit.Color(155, 173, 130),
        );
      p.markerLayout?.draw(canvas, p.left - 26, y);
      if (p.block.kind !== "paragraph") p.layout.draw(canvas, p.left, y);
      if (a !== b && a <= p.start + p.text.length && b >= p.start) {
        const g = p.layout.geometry(
          Math.max(0, a - p.start),
          Math.min(p.text.length, b - p.start),
          selection.upstream,
        );
        for (const r of g.rects)
          drawRect(
            r,
            p.left,
            y,
            kit.Color(170, 196, 139, p.block.kind === "paragraph" ? 0.5 : 0.3),
          );
      }
      if (boundsInput.checked) {
        for (const line of p.layout.lines) {
          drawRect(
            [0, line.top, Math.max(line.width, 2), line.bottom],
            p.left,
            y,
            kit.Color(90, 124, 53, 0.06),
          );
          drawRect(
            [0, line.baseline, this.width - 64, line.baseline + 0.6],
            p.left,
            y,
            kit.Color(90, 124, 53, 0.35),
          );
        }
      }
      if (p.block.kind === "paragraph") p.layout.draw(canvas, p.left, y);
    }
    const p = this.current();
    if (p) {
      const r = p.layout.geometry(
        selection.focus - p.start,
        selection.focus - p.start,
        selection.upstream,
      ).caret;
      this.input.style.left = `${Math.max(0, Math.min(this.width - 4, p.left + r[0]))}px`;
      this.input.style.top = `${p.top + r[1]}px`;
      this.input.style.fontSize = `${size}px`;
      if (active === this && selection.anchor === selection.focus)
        drawRect(r, p.left, p.top - scroll, kit.Color(71, 101, 41));
      if (active === this && composing)
        drawRect(
          [r[0] - 12, r[3] - 2, r[0] + 2, r[3]],
          32,
          p.top - scroll,
          kit.Color(71, 101, 41),
        );
    }
    fill.delete();
    canvas.restore();
    this.surface.flush();
    this.drawMs = performance.now() - started;
    const lines = this.placed.reduce((n, p) => n + p.layout.lines.length, 0),
      missing = this.placed.reduce((n, p) => n + p.layout.missing, 0);
    this.footer.innerHTML = `<span><strong>${lines}</strong> lines</span><span>Last layout <strong>${this.layoutMs.toFixed(2)} ms</strong></span><span>Adapter <strong>${this.adapterMs.toFixed(2)} ms</strong></span><span>Draw submit <strong>${this.drawMs.toFixed(2)} ms</strong></span>${missing ? `<span class="error">${missing} unresolved ${this.engine.name === "CanvasKit" ? "codepoints" : "glyphs"}</span>` : ""}`;
  }
  key(e: KeyboardEvent) {
    if (e.isComposing || composing) return;
    if (e.key === "Tab" && leafAt(doc, selection.focus).item !== null) {
      e.preventDefault();
      applyStructure(() => indent(doc, selection, e.shiftKey));
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      history(!e.shiftKey);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && ["b", "i"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      applyFormat(e.key.toLowerCase() === "b" ? "bold" : "italic");
      return;
    }
    const direction: Direction | null =
      e.key === "ArrowLeft"
        ? "left"
        : e.key === "ArrowRight"
          ? "right"
          : e.key === "ArrowUp"
            ? "up"
            : e.key === "ArrowDown"
              ? "down"
              : e.key === "Home"
                ? "home"
                : e.key === "End"
                  ? "end"
                  : null;
    if (!direction) return;
    // Let the platform textarea provide word/document navigation modifiers.
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const p = this.current();
    if (!p) return;
    if (
      selection.anchor !== selection.focus &&
      !e.shiftKey &&
      (direction === "left" || direction === "right")
    ) {
      const index =
        direction === "left"
          ? Math.min(selection.anchor, selection.focus)
          : Math.max(selection.anchor, selection.focus);
      selection = {
        anchor: index,
        focus: index,
        upstream: direction === "left",
      };
      render();
      this.reveal();
      return;
    }
    const local = selection.focus - p.start;
    let pos = p.layout.move(local, selection.upstream, direction);
    const stops = boundaries(p.text);
    // Engine shaping clusters may be smaller than the editor's grapheme unit.
    // Walk through those intermediate visual positions before changing selection.
    const visited = new Set<string>();
    while (!stops.includes(pos.index)) {
      const key = `${pos.index}:${pos.upstream}`;
      if (visited.has(key)) {
        pos = { ...pos, index: nearestBoundary(p.text, pos.index) };
        break;
      }
      visited.add(key);
      pos = p.layout.move(pos.index, pos.upstream, direction);
    }
    if (pos.index === local && pos.upstream === selection.upstream) {
      const previous = direction === "left" || direction === "up";
      const next = direction === "right" || direction === "down";
      const sibling = this.placed[this.placed.indexOf(p) + (previous ? -1 : 1)];
      if ((previous || next) && sibling) {
        const index = sibling.start + (previous ? sibling.text.length : 0);
        selection = {
          anchor: e.shiftKey ? selection.anchor : index,
          focus: index,
          upstream: previous,
        };
        render();
        this.reveal();
        return;
      }
    }
    selection = {
      anchor: e.shiftKey ? selection.anchor : p.start + pos.index,
      focus: p.start + pos.index,
      upstream: pos.upstream,
    };
    render();
    this.reveal();
  }
}

benchmarkButton.onclick = async () => {
  benchmarkButton.disabled = true;
  benchmarkButton.textContent = "Measuring…";
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const records: { engine: string; core: number[]; adapter: number[] }[] =
    panes.map((p) => ({ engine: p.engine.name, core: [], adapter: [] }));
  const width = Math.max(40, Math.min(...panes.map((p) => p.width)) - 64),
    fontSize = size;
  // Rotate order per round. Rebuild a fixed paragraph with warm font caches.
  const text = Array(32).fill(samples.prose.text).join("\n");
  for (let round = 0; round < 24; round++) {
    for (const i of round % 2 ? [1, 0] : [0, 1]) {
      const pane = panes[i];
      const layout = pane.engine.layout({
        id: 1000000,
        text,
        spans: samples.prose.spans,
        width,
        size: fontSize,
      });
      if (round >= 4) {
        records[i].core.push(layout.coreMs);
        records[i].adapter.push(layout.adapterMs);
      }
      layout.dispose();
    }
    if (round % 4 === 0)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const median = (a: number[]) =>
    [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
  const timing = (value: number) =>
    value === 0 ? "Below clock resolution" : `${value.toFixed(3)} ms`;
  element("#benchmark-result", HTMLDivElement).innerHTML =
    `<p>${text.length.toLocaleString()} UTF-16 units · ${Math.round(width)} px width · ${fontSize} px type · 4 warm-up rounds, 20 measured rounds</p><table><thead><tr><th>Engine</th><th>Core median</th><th>Adapter median</th><th>Samples</th></tr></thead><tbody>${records.map((r) => `<tr><td>${r.engine}</td><td>${timing(median(r.core))}</td><td>${timing(median(r.adapter))}</td><td>${r.core.length}</td></tr>`).join("")}</tbody></table>`;
  element("#measurements", HTMLElement).hidden = false;
  benchmarkButton.disabled = false;
  benchmarkButton.textContent = "Measure layout";
};

initialize()
  .then(({ kit, engines, loadMs, fontBytes, parleyBytes }) => {
    loading.hidden = true;
    editors.hidden = false;
    panes = engines.map((engine) => new Pane(kit, engine));
    render();
    element("#load-status", HTMLParagraphElement).textContent =
      `Ready in ${(loadMs / 1000).toFixed(2)} s · Shared fonts ${(fontBytes / 1024 / 1024).toFixed(1)} MiB · Parley WASM ${(parleyBytes / 1024 / 1024).toFixed(1)} MiB · Timing depends on this browser, machine, and cache.`;
    document.documentElement.dataset.ready = "true";
    // Read-only diagnostics used by the browser experiment checks.
    Object.defineProperty(window, "gprose", {
      value: {
        snapshot: () => ({
          blocks: doc.blocks,
          leaves: doc.leaves,
          text: doc.text,
          spans: doc.spans,
          selection,
          composing,
          panes: panes.map((p) => ({
            name: p.engine.name,
            lines: p.placed.flatMap((v) => v.layout.lines),
            missing: p.placed.reduce((n, v) => n + v.layout.missing, 0),
            layoutMs: p.layoutMs,
            adapterMs: p.adapterMs,
            paragraphs: p.placed.map((v) => ({
              id: v.id,
              kind: v.block.kind,
              left: v.left,
              start: v.start,
              text: v.text,
              top: v.top,
              height: v.layout.height,
            })),
            width: p.width,
          })),
        }),
        caret: (name: string, index: number, upstream = false) => {
          const pane = panes.find((p) => p.engine.name === name);
          const p = pane?.placed.find(
            (p) => index >= p.start && index <= p.start + p.text.length,
          );
          return p
            ? {
                rect: p.layout.geometry(
                  index - p.start,
                  index - p.start,
                  upstream,
                ).caret,
                top: p.top,
                left: p.left,
              }
            : null;
        },
        boundaries: () => boundaries(doc.text),
      },
    });
  })
  .catch((error) => {
    loading.hidden = false;
    loading.textContent = `Could not start the experiment: ${error instanceof Error ? error.message : String(error)}`;
    loading.classList.add("error");
    document.documentElement.dataset.ready = "error";
  });
