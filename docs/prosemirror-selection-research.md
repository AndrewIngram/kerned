# ProseMirror selection architecture

Investigated 2026-09-19 against the upstream source linked below. These findings informed the subsequent [selection implementation](editor-selections.md).

## Shared protocol, several selection kinds

ProseMirror's `Selection` base class provides anchor/head, multiple ranges, equality, mapping, content/replacement, JSON and bookmarks. `from`/`to` describe the **first, primary range**, not the bounding extent of every range. Subclasses can override editing semantics. JSON dispatch uses registered type IDs. A bookmark maps without a document and resolves against a later document, with a fallback when necessary. [Selection source](https://github.com/ProseMirror/prosemirror-state/blob/master/src/selection.ts)

| Type            | Meaning                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `TextSelection` | Directional anchor/head in inline content, potentially in different textblocks; equal endpoints represent a cursor. |
| `NodeSelection` | One whole selectable non-text node, including a container. It is not limited to atoms.                              |
| `AllSelection`  | The whole document, including edge blocks that a text selection cannot cover.                                       |

Text mapping falls back when endpoints cease to be valid text positions. Node mapping falls back when the selected node is deleted. All-selection resolves against the entire new document. Custom kinds implement the same protocol; `CellSelection` lives in the table package. [Selection source](https://github.com/ProseMirror/prosemirror-state/blob/master/src/selection.ts)

## Cells: selection intent plus disjoint ranges

`CellSelection` stores anchor/head cell positions in the same table. It derives a logical rectangle, then one content range per selected cell. The **head cell is the first range**, making it primary. The inherited text endpoints are therefore not the anchor/head cell identities. Mapping preserves full-row/full-column selection when the table changes; invalid cell endpoints fall back to text selection. Its JSON and bookmark retain cell endpoints. [Cell selection source](https://github.com/ProseMirror/prosemirror-tables/blob/master/src/cellselection.ts)

Cell copy produces a rectangular slice, adjusting spans at its edges. Replacement operates on each mapped cell-content range, inserting supplied content only in the primary one. Cell outlines are rendered through decorations rather than the browser's native selection. This is more than a special highlight over an ordinary text range. [Cell selection source](https://github.com/ProseMirror/prosemirror-tables/blob/master/src/cellselection.ts)

`TableMap` is a logical grid: a width × height array identifies the cell occupying each slot, repeating entries for spans. It provides cell bounds, adjacent cells, rectangles and deduplicated cell enumeration. Positions are table-relative, allowing the map to be cached by immutable table-node identity independently of its document position. It also records structural problems for normalization. [TableMap source](https://github.com/ProseMirror/prosemirror-tables/blob/master/src/tablemap.ts)

The table plugin wires pointer/keyboard input, paste, decorations and normalization. It maps an active drag anchor through transactions. By default, selecting the table node becomes a selection of all cells; an option retains node selection. These are extension policies, not core selection rules. [Table plugin source](https://github.com/ProseMirror/prosemirror-tables/blob/master/src/index.ts)

## Transactions, history and persistence

Transactions lazily map the current selection through newly added steps. An explicit selection must refer to the transaction's current document. Replacement/deletion delegates to the selection's behavior, so custom selections participate without the transaction naming table types. [Transaction source](https://github.com/ProseMirror/prosemirror-state/blob/master/src/transaction.ts)

History stores selection bookmarks at event boundaries, maps them with intervening changes and resolves them against the undo/redo result. It retains position maps for changes excluded from undo, including collaboration-related changes. A bookmark is not itself a durable remote reference: it still depends on the relevant mappings and document. [History source](https://github.com/ProseMirror/prosemirror-history/blob/master/src/history.ts)

## Recommended adaptation for kerned

Mimic the protocol and observable behavior, using our stable identities and in-memory TypeScript pipeline:

- Provide text, node and all-document selections. Text endpoints must independently identify nodes and offsets so selection can cross blocks.
- Register custom selection handlers per editor. Handlers own equality, mapping/fallback, range resolution, replacement, bookmarks and persistence codecs. A table extension registers cell selection without adding table names to core.
- Keep selection intent separate from resolved ranges and paint geometry. Preserve a primary range explicitly; never edit a rectangle using the minimum/maximum document offsets.
- Keep live handlers and selection data in memory. Serialize only at persistence/network boundaries, using stable node/cell keys and versioned payloads.
- Distinguish a restorable editor bookmark from a durable annotation reference. Selection may fall back to a nearby valid position; a deleted annotation target should remain explicitly deleted.

First validate cross-block text selection, node/all selection, undo restoration, moves/deletions and codecs. Then prove the public extension contract with cell selection over a headless table fixture, including spans and disjoint edits, before adding table interactions.
