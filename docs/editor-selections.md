# Extensible selections

The core now follows ProseMirror's separation between selection behavior, document structure and rendered geometry. This implements the first headless milestone from [the source investigation](prosemirror-selection-research.md).

## Public usage

```ts
const editor = createEditor(schema, nodes,
  new TextSelection({id: firstTextId, offset: 2}, {id: lastTextId, offset: 5}),
  [tableSelections.extension]);

const command = editor.selectionEdit('replacement');
editor.dispatch({baseRevision: editor.state.revision, origin: 'local',
  history: 'separate', time: performance.now(), ...command});

const saved = editor.selectionJSON();
editor.select(editor.readSelection(saved));
```

`TextSelection` has independent anchor and head points and preserves direction. `NodeSelection` selects one schema-selectable node, including containers. `AllSelection` supports whole and empty documents. `textSelection(id, anchor, head?, upstream?)` constructs the common single-block case.

Applications register custom selection codecs per editor. Selection objects implement validation, equality, range resolution, emptiness, replacement, content extraction, mapping, history bookmarks and explicit encoding. The runtime calls methods directly; it does not serialize selections during edits. The core does not name tables or cell selections.

`ranges(context)` returns text slices and whole-node ranges. The first range is primary; the collection is not a bounding interval. `content(context)` retains the source nodes and text boundaries so extensions can access their rich data. This is not yet a schema-independent clipboard slice format.

Selection context exposes identity lookup, tree navigation, text and selectability through the schema boundary. `positions.ts` owns numeric text maps; selection and transactions use that shared module. The table extension and independent tests import only the public entry point.

## Mapping, history and persistence

Text endpoints map independently through replacement, split and join. Surviving numeric handles follow structural moves. Deleted targets fall back to valid text, a selectable node or whole-document selection. Explicit transaction selections are validated and invalid transactions publish nothing.

History stores document-independent bookmarks and resolves them after undo/redo restores content. Bookmark mapping is public and tested. Existing history still supports local conditional inverses and append-only streaming; it does not rebase remote operations or provide selective collaborative undo.

Selection codecs encode stable node keys and validate their versioned payloads on read. A saved selection must accompany the appropriate document revision. It is not a durable relative reference across arbitrary unseen edits. Persisted annotations continue to use the separate revision-aware anchor journal and explicit deleted status. A live selection's fallback must not silently relocate a deleted annotation.

Schema extensions may set `selectable: false`. The default permits node selection. Whole-document deletion can leave an empty document; a schema-specific command may insert a default block if its application requires one.

## Table extension proof

`createCellSelectionExtension(adapter)` accepts a schema-owned projection into logical rows with cell IDs and spans. Its grid stores cell indexes in an `Int32Array`, repeats indexes for spans, and rejects overlaps, gaps, duplicates and out-of-bounds spans. It caches by immutable table node identity; unrelated root arrivals preserve the cache.

A cell selection stores table, anchor and head identities, plus rectangle/row/column extent. It resolves the head cell first and enumerates separate cell-content ranges. Spanning cells are counted once. Like ProseMirror's rectangle enumeration, cells whose top-left starts outside the rectangle are excluded. Row and column extents recalculate against the current table after structural edits.

Replacement clears selected text ranges, puts supplied text in the head cell's first text block, and preserves unselected cells. Selected atomic content is removed through generic structural steps. Undo restores the cell selection. Invalidated table endpoints fall back through the generic selection protocol.

This is a headless extension proof. It does not ship table insertion/rendering, drag selection, navigation, merge/split commands, span-aware clipboard slices, or schema normalization. Schema validation remains responsible for maintaining valid cell contents after a command.

## Current editing limits

Core text replacement joins text siblings and removes intervening atoms. Replacement across different containers explicitly requires a schema-aware structural command, because the engine cannot decide which wrappers to lift, merge or retain. Node/all replacement with a nonempty string likewise requires a schema insertion command to create the appropriate text node. Unsupported commands fail before dispatch.

The editor demo retains independent text anchor and head positions across paragraphs. Pointer dragging, Shift-click, keyboard extension, copy, replacement and undo use that selection directly. Node, all and cell interactions remain headless API capabilities.

## Verification

`npm run build` type-checks and builds the migrated demo. `npm run check:editor-boundaries` checks core dependencies and public-only extension fixtures.

`npm run check:transactions` runs 48 selection assertions alongside container, extension and transaction assertions in Chromium, Firefox and WebKit at wide and narrow viewports. Selection coverage includes cross-block forward/backward ranges, sibling replacement, content extraction, split mapping, node moves and deletion, empty/atom-only documents, schema selectability, malformed codecs, stable-key restoration with different local handles, bookmarks, disjoint cell edits, spans, column growth, cache reuse and undo/redo. The existing browser interaction tests exercise typing, split/join and streamed arrivals.

`npm run check:editor-large` passes the existing 2,000/10,000-block cases in all three browsers. These checks establish behavior, not a new latency benchmark.

## Pointer input regression

The canvas now prevents the default pointer-down action from taking focus back from the hidden textarea, and captures the pointer while dragging a text selection. Earlier checks set the caret through the test API and missed both click-to-type focus loss and missing drag handling. `npm run check:editor-pointer` exercises real clicks, dragging and typing against the dev server, including 150% zoom.

Comment highlight overlays share the text pointer handler. Clicking places the caret at the hit-tested offset while opening the comment without taking text focus. Dragging works through the highlight. Keyboard activation of the comment button still moves focus into its panel. The pointer regression suite checks both paths. Mentions retain their atomic button behavior.
