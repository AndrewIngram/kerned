import { test, expect } from "@playwright/test";
import {
  Document,
  paragraph,
  replace,
  toggleBlock,
  enter,
  format,
  insertAtom,
} from "../src/model.ts";
const selection = (anchor, focus = anchor) => ({
  anchor,
  focus,
  upstream: false,
});

test("edits at atom boundaries preserve unselected media and surrounding styles", () => {
  const original = new Document([
    paragraph("Before", [{ start: 0, end: 6, bold: true, italic: false }]),
  ]);
  const inserted = insertAtom(original, selection(6), {
    kind: "embed",
    title: "Reference",
    url: "https://example.com",
  }).doc;
  const atom = inserted.blocks[1];
  const joined = replace(inserted, 6, 7, "");
  expect(joined.blocks[1]).toEqual(atom);
  expect(joined.text).toBe(inserted.text);
  expect(joined.blocks[0].spans).toEqual(original.blocks[0].spans);
  const before = replace(inserted, 7, 7, "Prefix");
  expect(before.blocks.map((b) => b.kind)).toEqual([
    "paragraph",
    "paragraph",
    "embed",
    "paragraph",
  ]);
  expect(before.text).toBe("Before\nPrefix\n\uFFFC\n");
  const after = replace(inserted, 8, 8, "Suffix");
  expect(after.text).toBe("Before\n\uFFFC\nSuffix\n");
  expect(after.blocks[1]).toEqual(atom);
});

test("converting a selected list changes its style once and retains nested structure", () => {
  let doc = new Document([
    paragraph("One"),
    paragraph("Two"),
    paragraph("Three"),
  ]);
  doc = toggleBlock(doc, selection(0, doc.text.length), "bullet");
  const before = JSON.stringify(doc.blocks);
  const converted = toggleBlock(doc, selection(0, doc.text.length), "number");
  expect(converted.blocks).toHaveLength(1);
  expect(converted.blocks[0].style).toBe("number");
  expect(converted.blocks[0].items).toHaveLength(3);
  expect(converted.leaves.map((p) => p.marker)).toEqual(["1.", "2.", "3."]);
  expect(JSON.stringify(doc.blocks)).toBe(before);
});

test("splitting styled list text preserves styles on both sides and immutable history", () => {
  let doc = new Document([paragraph("A sentence")]);
  doc = format(doc, 0, doc.text.length, "italic");
  doc = toggleBlock(doc, selection(0), "bullet");
  const next = enter(doc, selection(2));
  expect(next.doc.text).toBe("A \nsentence");
  expect(next.doc.blocks[0].items).toHaveLength(2);
  expect(next.doc.leaves.every((p) => p.spans.some((s) => s.italic))).toBe(
    true,
  );
  expect(doc.text).toBe("A sentence");
});

test("exiting an empty paragraph splits a quote without reordering later text", () => {
  let doc = new Document([
    paragraph("Before"),
    paragraph(""),
    paragraph("After"),
  ]);
  doc = toggleBlock(doc, selection(0, doc.text.length), "quote");
  const result = enter(doc, selection(7));
  expect(result.doc.text).toBe("Before\n\nAfter");
  expect(result.doc.blocks.map((b) => b.kind)).toEqual([
    "quote",
    "paragraph",
    "quote",
  ]);
  expect(result.index).toBe(7);
});
