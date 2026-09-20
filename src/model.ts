import {boundaries} from './editor/text';
export {boundaries} from './editor/text';
export type Span = {
  start: number;
  end: number;
  bold: boolean;
  italic: boolean;
};
type TextDocument = { text: string; spans: Span[] };
export type Position = { index: number; upstream: boolean };
export type Selection = { anchor: number; focus: number; upstream: boolean };
export type Direction = "left" | "right" | "up" | "down" | "home" | "end";

const textSamples: Record<string, TextDocument> = {
  prose: {
    text: "The shape of a sentence\nA good editor lets you follow a thought. The words should stay steady as a sentence grows, wraps, and finds its rhythm.\nSelect a few words and make them bold or italic. Click in either pane to write; the other follows along.\nTypography has small surprises: office, affinity, café, naïve, and a carefully placed em dash — all deserve a proper home.",
    spans: [
      { start: 0, end: 23, bold: true, italic: false },
      { start: 46, end: 62, bold: false, italic: true },
    ],
  },
  scripts: {
    text: "One document, many directions\nWe will meet at 09:35. مرحبًا بالعالم — שלום עולם. Then return to English.\n日本語の文章は、単語の間に空白を入れずに書かれます。文字の折り返しを比較します。\nनमस्ते दुनिया। अक्षरों का सही आकार और स्थान महत्वपूर्ण है।\nCafé / café · office · fi · ffi · 👨‍👩‍👧‍👦 · 👩🏽‍🚀 · 🇬🇧\nTry selecting across languages, and moving the caret through a wrapped line.",
    spans: [{ start: 0, end: 29, bold: true, italic: false }],
  },
  empty: { text: "", spans: [] },
};
const longParagraph =
  "Writing is thinking in motion. A sentence gathers detail, pauses for breath, and changes direction. The editor should keep up with the thought, even when the document stretches beyond the window. ";
textSamples.long = {
  text: Array.from(
    { length: 100 },
    (_, i) => `${i + 1}. ${longParagraph.repeat(3)}`,
  ).join("\n"),
  spans: [],
};

function textParagraphs(doc: TextDocument) {
  let offset = 0;
  return doc.text.split("\n").map((text, id) => {
    const start = offset;
    offset += text.length + 1;
    return {
      id,
      start,
      text,
      spans: doc.spans
        .filter((s) => s.end > start && s.start < start + text.length)
        .map((s) => ({
          ...s,
          start: Math.max(0, s.start - start),
          end: Math.min(text.length, s.end - start),
        })),
    };
  });
}

function textReplace(
  doc: TextDocument,
  start: number,
  end: number,
  insert: string,
): TextDocument {
  const delta = insert.length - (end - start);
  const spans: Span[] = [];
  const inherited = doc.spans.find((s) => s.start <= start && s.end > start);
  for (const s of doc.spans) {
    if (s.start < start) {
      const e = Math.min(s.end, start);
      if (e > s.start) spans.push({ ...s, end: e });
    }
    if (s.end > end) {
      const b = Math.max(s.start, end);
      spans.push({ ...s, start: b + delta, end: s.end + delta });
    }
  }
  if (insert.length && inherited)
    spans.push({ ...inherited, start, end: start + insert.length });
  return {
    text: doc.text.slice(0, start) + insert + doc.text.slice(end),
    spans,
  };
}

function textFormat(
  doc: TextDocument,
  start: number,
  end: number,
  key: "bold" | "italic",
): TextDocument {
  if (start === end) return doc;
  const breaks = new Set([
    0,
    doc.text.length,
    start,
    end,
    ...doc.spans.flatMap((s) => [s.start, s.end]),
  ]);
  const points = [...breaks].sort((a, b) => a - b);
  const selected = points.slice(0, -1).filter((p) => p >= start && p < end);
  const enable = !selected.every((p) =>
    doc.spans.some((s) => s.start <= p && s.end > p && s[key]),
  );
  const spans: Span[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1];
    const current = doc.spans.filter((s) => s.start <= a && s.end >= b);
    const style = {
      bold: current.some((s) => s.bold),
      italic: current.some((s) => s.italic),
    };
    if (a >= start && b <= end) style[key] = enable;
    if (style.bold || style.italic) spans.push({ start: a, end: b, ...style });
  }
  return { text: doc.text, spans };
}

export function nearestBoundary(text: string, index: number): number {
  return boundaries(text).reduce(
    (best, current) =>
      Math.abs(current - index) < Math.abs(best - index) ? current : best,
    0,
  );
}

// The block tree is authoritative. Text and spans are a derived UTF-16 input
// projection; atomic blocks occupy one object-replacement character.
export type Paragraph = {
  kind: "paragraph";
  id: number;
  text: string;
  spans: Span[];
};
export type Atom =
  | {
      kind: "image";
      id: number;
      source: string;
      title: string;
      width: number;
      height: number;
    }
  | { kind: "embed"; id: number; title: string; url: string };
export type Item = { id: number; children: Block[] };
export type Block =
  | Paragraph
  | Atom
  | { kind: "quote"; id: number; children: Block[] }
  | { kind: "list"; id: number; style: "bullet" | "number"; items: Item[] };
let nextId = 1;
const id = () => nextId++;
export const paragraph = (text = "", spans: Span[] = []): Paragraph => ({
  kind: "paragraph",
  id: id(),
  text,
  spans,
});
export type Leaf = {
  id: number;
  start: number;
  text: string;
  spans: Span[];
  block: Paragraph | Atom;
  depth: number;
  quotes: number[];
  marker: string;
  item: number | null;
};
export class Document {
  readonly text: string;
  readonly spans: Span[];
  readonly leaves: Leaf[];
  constructor(readonly blocks: Block[]) {
    this.leaves = [];
    let offset = 0;
    const walk = (
      blocks: Block[],
      depth: number,
      quotes: number[],
      marker = "",
      item: number | null = null,
    ) => {
      for (const b of blocks) {
        if (b.kind === "quote")
          walk(b.children, depth, [...quotes, b.id], marker, item);
        else if (b.kind === "list")
          b.items.forEach((child, i) =>
            walk(
              child.children,
              depth + 1,
              quotes,
              b.style === "bullet" ? "•" : `${i + 1}.`,
              child.id,
            ),
          );
        else {
          const text = b.kind === "paragraph" ? b.text : "\uFFFC";
          this.leaves.push({
            id: b.id,
            start: offset,
            text,
            spans: b.kind === "paragraph" ? b.spans : [],
            block: b,
            depth,
            quotes,
            marker,
            item,
          });
          offset += text.length + 1;
        }
        marker = "";
      }
    };
    walk(blocks, 0, []);
    this.text = this.leaves.map((p) => p.text).join("\n");
    this.spans = this.leaves.flatMap((p) =>
      p.spans.map((s) => ({
        ...s,
        start: s.start + p.start,
        end: s.end + p.start,
      })),
    );
  }
}
export const samples: Record<string, Document> = Object.fromEntries(
  Object.entries(textSamples).map(([name, doc]) => [
    name,
    new Document(textParagraphs(doc).map((p) => paragraph(p.text, p.spans))),
  ]),
);
const item = (children: Block[]): Item => ({ id: id(), children });
samples.structured = new Document([
  paragraph("A document with room for structure", [
    { start: 0, end: 34, bold: true, italic: false },
  ]),
  paragraph(
    "Lists, quotes, and media share the same document in both panes. Try Enter in a list, then Tab or Shift+Tab.",
  ),
  {
    kind: "list",
    id: id(),
    style: "number",
    items: [
      item([
        paragraph("Start with a thought."),
        {
          kind: "list",
          id: id(),
          style: "bullet",
          items: [
            item([paragraph("Give the details their own space.")]),
            item([
              paragraph("Nested items wrap within their own indentation."),
            ]),
          ],
        },
      ]),
      item([paragraph("Keep the words editable.")]),
    ],
  },
  {
    kind: "quote",
    id: id(),
    children: [
      paragraph("A quote can contain more than one paragraph."),
      paragraph(
        "Its structure belongs to the document, while each engine shapes the words.",
      ),
    ],
  },
  {
    kind: "embed",
    id: id(),
    title: "Explore Yoga",
    url: "https://github.com/react/yoga",
  },
  paragraph(
    "Insert an image from your computer, or add another link card with Embed.",
  ),
]);
export function paragraphs(doc: Document) {
  return doc.leaves;
}
export function leafAt(doc: Document, index: number) {
  return (
    doc.leaves.find(
      (p) => index >= p.start && index <= p.start + p.text.length,
    ) ?? doc.leaves[doc.leaves.length - 1]
  );
}
function transform(
  blocks: Block[],
  fn: (block: Paragraph | Atom) => Block[],
): Block[] {
  return blocks.flatMap((b) => {
    if (b.kind === "quote") {
      const children = transform(b.children, fn);
      return children.length ? [{ ...b, children }] : [];
    }
    if (b.kind === "list") {
      const items = b.items
        .map((i) => ({ ...i, children: transform(i.children, fn) }))
        .filter((i) => i.children.length);
      return items.length ? [{ ...b, items }] : [];
    }
    return fn(b);
  });
}
const documentFrom = (blocks: Block[]) =>
  new Document(blocks.length ? blocks : [paragraph()]);
export function replace(
  doc: Document,
  start: number,
  end: number,
  insert: string,
): Document {
  if (start === end && !insert) return doc;
  const first = leafAt(doc, start),
    last = leafAt(doc, end);
  const affected = new Set(
    doc.leaves
      .filter((p) => p.start >= first.start && p.start <= last.start)
      .map((p) => p.id),
  );
  const localDoc = {
    text: doc.text.slice(first.start, last.start + last.text.length),
    spans: doc.spans
      .filter(
        (s) => s.end > first.start && s.start < last.start + last.text.length,
      )
      .map((s) => ({
        ...s,
        start: s.start - first.start,
        end: s.end - first.start,
      })),
  };
  const updated = textReplace(
    localDoc,
    start - first.start,
    end - first.start,
    insert.replaceAll("\uFFFC", ""),
  );
  const prefixAtom =
    first.block.kind !== "paragraph" && start > first.start
      ? first.block
      : null;
  const suffixAtom =
    last.block.kind !== "paragraph" &&
    end === last.start &&
    last.id !== prefixAtom?.id
      ? last.block
      : null;
  let middle = updated;
  if (prefixAtom) {
    const cut = middle.text.startsWith("\uFFFC\n") ? 2 : 1;
    middle = textReplace(middle, 0, cut, "");
  }
  if (suffixAtom) {
    const cut = middle.text.endsWith("\n\uFFFC") ? 2 : 1;
    middle = textReplace(
      middle,
      middle.text.length - cut,
      middle.text.length,
      "",
    );
  }
  const includeText =
    middle.text.length > 0 ||
    first.block.kind === "paragraph" ||
    last.block.kind === "paragraph";
  const replacement: Block[] = [
    ...(prefixAtom ? [prefixAtom] : []),
    ...(includeText
      ? textParagraphs(middle).map((p, i) => ({
          ...paragraph(p.text, p.spans),
          ...(i === 0 && first.block.kind === "paragraph"
            ? { id: first.id }
            : {}),
        }))
      : []),
    ...(suffixAtom ? [suffixAtom] : []),
  ];
  return documentFrom(
    transform(doc.blocks, (b) =>
      b.id === first.id ? replacement : affected.has(b.id) ? [] : [b],
    ),
  );
}
export function reconcile(doc: Document, text: string): Document {
  if (doc.text === text) return doc;
  let start = 0;
  while (
    start < doc.text.length &&
    start < text.length &&
    doc.text[start] === text[start]
  )
    start++;
  if (start && /[\uD800-\uDBFF]/.test(doc.text[start - 1])) start--;
  let end = doc.text.length,
    nextEnd = text.length;
  while (
    end > start &&
    nextEnd > start &&
    doc.text[end - 1] === text[nextEnd - 1]
  ) {
    end--;
    nextEnd--;
  }
  if (end < doc.text.length && /[\uDC00-\uDFFF]/.test(doc.text[end])) {
    end++;
    nextEnd++;
  }
  return replace(doc, start, end, text.slice(start, nextEnd));
}
export function format(
  doc: Document,
  start: number,
  end: number,
  key: "bold" | "italic",
): Document {
  const formatted = textFormat(doc, start, end, key);
  return new Document(
    transform(doc.blocks, (b) => {
      if (b.kind !== "paragraph") return [b];
      const leaf = leafAt(
        doc,
        doc.leaves.find((p) => p.id === b.id)?.start ?? 0,
      );
      return [
        {
          ...b,
          spans: formatted.spans
            .filter(
              (s) =>
                s.end > leaf.start && s.start < leaf.start + leaf.text.length,
            )
            .map((s) => ({
              ...s,
              start: Math.max(0, s.start - leaf.start),
              end: Math.min(leaf.text.length, s.end - leaf.start),
            })),
        },
      ];
    }),
  );
}
function selectedIds(doc: Document, selection: Selection) {
  const a = Math.min(selection.anchor, selection.focus),
    b = Math.max(selection.anchor, selection.focus);
  return new Set(
    doc.leaves
      .filter((p) =>
        a === b
          ? p.id === leafAt(doc, a).id
          : p.start < b && p.start + p.text.length >= a,
      )
      .map((p) => p.id),
  );
}
// Work on one cloned tree per structural command; published snapshots stay immutable.
function locate(
  blocks: Block[],
  target: number,
): { siblings: Block[]; index: number } | null {
  for (let index = 0; index < blocks.length; index++) {
    const b = blocks[index];
    if (b.id === target) return { siblings: blocks, index };
    if (b.kind === "quote") {
      const found = locate(b.children, target);
      if (found) return found;
    }
    if (b.kind === "list")
      for (const i of b.items) {
        const found = locate(i.children, target);
        if (found) return found;
      }
  }
  return null;
}
function findList(
  blocks: Block[],
  itemId: number,
): {
  list: Extract<Block, { kind: "list" }>;
  index: number;
  siblings: Block[];
  blockIndex: number;
} | null {
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const b = blocks[blockIndex];
    if (b.kind === "quote") {
      const found = findList(b.children, itemId);
      if (found) return found;
    }
    if (b.kind === "list") {
      const index = b.items.findIndex((i) => i.id === itemId);
      if (index >= 0) return { list: b, index, siblings: blocks, blockIndex };
      for (const i of b.items) {
        const found = findList(i.children, itemId);
        if (found) return found;
      }
    }
  }
  return null;
}
function clean(blocks: Block[]): Block[] {
  const result: Block[] = [];
  for (const b of blocks) {
    if (b.kind === "quote") {
      b.children = clean(b.children);
      if (!b.children.length) continue;
    }
    if (b.kind === "list") {
      b.items = b.items
        .map((i) => ({ ...i, children: clean(i.children) }))
        .filter((i) => i.children.length);
      if (!b.items.length) continue;
      const previous = result.at(-1);
      if (previous?.kind === "list" && previous.style === b.style) {
        previous.items.push(...b.items);
        continue;
      }
    }
    result.push(b);
  }
  return result;
}
export function toggleBlock(
  doc: Document,
  selection: Selection,
  kind: "bullet" | "number" | "quote",
): Document {
  const blocks = structuredClone(doc.blocks),
    ids = selectedIds(doc, selection);
  if (kind === "quote") {
    const leaves = doc.leaves.filter((p) => ids.has(p.id));
    const common = leaves[0]?.quotes.find((q) =>
      leaves.every((p) => p.quotes.includes(q)),
    );
    if (common) {
      const found = locate(blocks, common);
      if (found) {
        const quote = found.siblings[found.index];
        if (quote.kind === "quote")
          found.siblings.splice(found.index, 1, ...quote.children);
      }
    } else {
      // Wrap the sibling range at the lowest common container, keeping lists intact.
      const contains = (b: Block): boolean =>
        b.kind === "quote"
          ? b.children.some(contains)
          : b.kind === "list"
            ? b.items.some((i) => i.children.some(contains))
            : ids.has(b.id);
      const wrap = (siblings: Block[]) => {
        const indexes = siblings.flatMap((b, i) => (contains(b) ? [i] : []));
        if (!indexes.length) return;
        if (indexes.length === 1) {
          const b = siblings[indexes[0]];
          if (b.kind === "quote") {
            wrap(b.children);
            return;
          }
        }
        const a = indexes[0],
          count = indexes[indexes.length - 1] - a + 1;
        siblings.splice(a, count, {
          kind: "quote",
          id: id(),
          children: siblings.slice(a, a + count),
        });
      };
      wrap(blocks);
    }
  } else {
    const selected = doc.leaves.filter((p) => ids.has(p.id));
    const processed = new Set<number>();
    const converted = new Set<number>();
    for (const leaf of selected) {
      if (leaf.item !== null) {
        if (processed.has(leaf.item)) continue;
        processed.add(leaf.item);
        const found = findList(blocks, leaf.item);
        if (!found) continue;
        if (converted.has(found.list.id)) continue;
        if (found.list.style !== kind) {
          found.list.style = kind;
          converted.add(found.list.id);
        } else liftItem(blocks, leaf.item);
      } else {
        const found = locate(blocks, leaf.id);
        if (found)
          found.siblings.splice(found.index, 1, {
            kind: "list",
            id: id(),
            style: kind,
            items: [item([found.siblings[found.index]])],
          });
      }
    }
  }
  return documentFrom(clean(blocks));
}
function liftItem(blocks: Block[], itemId: number) {
  const found = findList(blocks, itemId);
  if (!found) return;
  const { list, index, siblings, blockIndex } = found;
  const [removed] = list.items.splice(index, 1);
  // A nested list lives in its parent's item. Lift after that parent item.
  const parentItem = (nodes: Block[]): Item | null => {
    for (const b of nodes) {
      if (b.kind === "quote") {
        const p = parentItem(b.children);
        if (p) return p;
      }
      if (b.kind === "list")
        for (const i of b.items) {
          if (i.children === siblings) return i;
          const p = parentItem(i.children);
          if (p) return p;
        }
    }
    return null;
  };
  const parent = parentItem(blocks);
  if (parent) {
    const outer = findList(blocks, parent.id);
    const trailing = list.items.splice(index);
    if (trailing.length)
      removed.children.push({ ...list, id: id(), items: trailing });
    if (outer) outer.list.items.splice(outer.index + 1, 0, removed);
  } else {
    const after = list.items.splice(index);
    siblings.splice(
      blockIndex + 1,
      0,
      ...removed.children,
      ...(after.length ? [{ ...list, id: id(), items: after }] : []),
    );
  }
}
export function indent(
  doc: Document,
  selection: Selection,
  outdent: boolean,
): Document {
  const leaf = leafAt(doc, selection.focus);
  if (leaf.item === null) return doc;
  const blocks = structuredClone(doc.blocks),
    found = findList(blocks, leaf.item);
  if (!found) return doc;
  if (outdent) liftItem(blocks, leaf.item);
  else {
    if (!found.index) return doc;
    const previous = found.list.items[found.index - 1];
    const [moving] = found.list.items.splice(found.index, 1);
    const tail = previous.children.at(-1);
    if (tail?.kind === "list" && tail.style === found.list.style)
      tail.items.push(moving);
    else
      previous.children.push({
        kind: "list",
        id: id(),
        style: found.list.style,
        items: [moving],
      });
  }
  return documentFrom(clean(blocks));
}
export function enter(
  doc: Document,
  selection: Selection,
): { doc: Document; index: number } {
  const start = Math.min(selection.anchor, selection.focus),
    end = Math.max(selection.anchor, selection.focus);
  if (start !== end) doc = replace(doc, start, end, "");
  const leaf = leafAt(doc, Math.min(start, doc.text.length));
  const blocks = structuredClone(doc.blocks);
  if (leaf.block.kind !== "paragraph") {
    const p = paragraph(),
      found = locate(blocks, leaf.id);
    if (found)
      found.siblings.splice(found.index + (start > leaf.start ? 1 : 0), 0, p);
    const next = documentFrom(blocks);
    return {
      doc: next,
      index: next.leaves.find((l) => l.id === p.id)?.start ?? start,
    };
  }
  if (!leaf.text && leaf.item !== null) {
    const next = indent(doc, selection, true);
    return {
      doc: next,
      index: next.leaves.find((p) => p.id === leaf.id)?.start ?? start,
    };
  }
  if (!leaf.text && leaf.quotes.length) {
    const found = locate(blocks, leaf.quotes[leaf.quotes.length - 1]);
    if (found) {
      const q = found.siblings[found.index];
      if (q.kind === "quote") {
        const emptyIndex = q.children.findIndex((b) => b.id === leaf.id);
        if (emptyIndex < 0) return { doc, index: start };
        const p = paragraph(),
          after = q.children.slice(emptyIndex + 1);
        q.children = q.children.slice(0, emptyIndex);
        found.siblings.splice(
          found.index + 1,
          0,
          p,
          ...(after.length ? [{ ...q, id: id(), children: after }] : []),
        );
        const next = documentFrom(clean(blocks));
        return {
          doc: next,
          index: next.leaves.find((l) => l.id === p.id)?.start ?? start,
        };
      }
    }
  }
  const local = Math.max(0, start - leaf.start);
  const halves = textParagraphs(textReplace(leaf.block, local, local, "\n"));
  const before = {
    ...leaf.block,
    text: halves[0].text,
    spans: halves[0].spans,
  };
  const after = paragraph(halves[1].text, halves[1].spans);
  const found = locate(blocks, leaf.id);
  if (found) {
    found.siblings.splice(found.index, 1, before);
    const list = leaf.item !== null ? findList(blocks, leaf.item) : null;
    if (list) {
      const following = found.siblings.splice(found.index + 1);
      list.list.items.splice(list.index + 1, 0, item([after, ...following]));
    } else found.siblings.splice(found.index + 1, 0, after);
  }
  const next = documentFrom(clean(blocks));
  return {
    doc: next,
    index: next.leaves.find((p) => p.id === after.id)?.start ?? start + 1,
  };
}
export function insertAtom(
  doc: Document,
  selection: Selection,
  atom:
    | Omit<Extract<Atom, { kind: "image" }>, "id">
    | Omit<Extract<Atom, { kind: "embed" }>, "id">,
): { doc: Document; index: number } {
  const start = Math.min(selection.anchor, selection.focus),
    end = Math.max(selection.anchor, selection.focus);
  if (start !== end) doc = replace(doc, start, end, "");
  const leaf = leafAt(doc, Math.min(start, doc.text.length));
  const blocks = structuredClone(doc.blocks),
    found = locate(blocks, leaf.id),
    added: Atom = { ...atom, id: id() };
  if (found) {
    if (leaf.block.kind === "paragraph") {
      const local = Math.max(0, start - leaf.start);
      const halves = textParagraphs(
        textReplace(leaf.block, local, local, "\n"),
      );
      found.siblings.splice(
        found.index,
        1,
        ...(halves[0].text
          ? [{ ...leaf.block, text: halves[0].text, spans: halves[0].spans }]
          : []),
        added,
        paragraph(halves[1].text, halves[1].spans),
      );
    } else found.siblings.splice(found.index + 1, 0, added, paragraph());
  }
  const next = documentFrom(clean(blocks));
  return {
    doc: next,
    index: next.leaves.find((p) => p.id === added.id)?.start ?? start,
  };
}
