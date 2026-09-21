# Second editor architecture audit

This pass traced session replacement, textarea synchronization, viewport changes,
and the dependency rules added by the app refactor.

## Fixed

- **Session lifetime:** `useCanvasInput` kept the first session in `useState`.
  Replacing the session without unmounting still synchronized from the old one.
  Capture and navigation now follow session identity; old composition work and
  listeners are released by the existing cleanup path.
- **Scrollport lifetime:** `useEditorViewport` observed its initial scroll mode
  forever. It now disconnects and observes the new scrollport when `page` changes.
- **Renderer configuration:** input coordinates and canvas drawing embedded the
  demo's 28-pixel inset. Both adapters now require an explicit inset. The starter
  kit owns that layout choice and passes it to both.
- **Repeated indexing:** textarea synchronization rebuilt the document index on
  each call. React now supplies its existing selection context. Standalone text
  capture caches a context by immutable document identity, rebuilding after edits.
- **Command ownership:** `actions.ts` still combined commands, DOM focus queries,
  keyboard handling and clipboard policy. Commands now receive effect callbacks;
  `input.ts` owns the starter kit's native input and focus conventions. The demo
  wires the two together. No adapter imports are allowed in the command module.
- **Boundary enforcement:** the check examined only top-level static imports in
  immediate child files. It now checks nested files, re-exports and literal dynamic
  imports, and rejects dynamic targets it cannot inspect. Built-in scanner cases
  cover these alternate import forms.

For command ownership, two alternatives were considered: retain one browser-aware
controller with grouped methods, or separate commands from browser event policy.
The latter was chosen because a command caller should not need to supply a DOM
root or textarea. The existing session remains the sole document-state owner.

## Verification

`src/editor-react/__tests__/adapter-audit.browser.test.js` exercises a mounted React host under StrictMode with
session replacement, composition cleanup, non-default insets, changing scrollports,
input after replacement, and index reuse/invalidation. It uses the independent
fixture schema rather than the demo's paragraph shape.

The production build and 54 focused browser tests pass, as do the ownership
checks and lint on the changed runtime modules.

The [three-trial benchmark](../artifacts/editor-adapter-audit/baseline.json), taken
after the input-index change and before the mechanical command/input separation,
passes every existing budget. Median book load was 1,132 ms (previous refactor:
1,199 ms), and paste-to-second-frame was 111 ms (previous: 116 ms). Typing and paging
remain about 32 ms. These development measurements do not isolate every source of
variation; the index-reuse regression test checks the algorithmic change directly.

## Selection follow-up

The view adapter now retains the actual `Selection`. Its `textSelection`, `start`
and `end` are null for non-text selections; an empty document has no focus node.
Command targets come from actual selection ranges, including separate cell ranges.
Node and all-document selections paint their selected descendants without creating
an unrelated text caret. The browser adapter clears stale native text capture when
leaving text selection, and shift-click starts a new text range when there is no
text anchor to extend.

Starter-kit copy/cut use the real selected content. Typing or pasting plain text
can replace a selected node; rich node replacement preserves the node's structural
location. Cell replacement uses the cell-selection extension so it preserves the
table grid. The later rectangular clipboard implementation replaces the former plain-text
fallback with rich grid paste; see `clipboard.md`.

`src/editor/__tests__/selection-adapters.test.js`, `tests/selection-adapters.browser.test.js`,
and `tests/e2e/selection-adapters.spec.js` exercise node/container/all/empty projection,
mounted React command targeting, disjoint cell formatting, native capture cleanup,
node cut/undo and replacement. No fabricated first-paragraph or ID-zero fallback
remains in the view adapter.

The subsequent node-interaction pass adds atomic-view clicks, arrow transitions,
and node-to-text seeds for modifier/page navigation. See
[atomic node interaction](editor-app-architecture.md#atomic-node-interaction) for
ownership and limitations. The structural-range follow-up now supplies edge
endpoints, range dragging, gap insertion and transaction mapping. Keyboard
transitions for an explicit `AllSelection` remain separate work.

Validation for this follow-up: the full browser suite passed (183 tests, three
existing concurrency skips); the final projected-table adjustment passed 54
focused tests across Chromium, Firefox and WebKit. Production build, ownership
checks, TypeScript and lint on the touched adapters/starter-kit modules passed.
The [three-trial selection benchmark](../artifacts/editor-selection-adapters/baseline.json)
passed every performance budget, including worst-trial checks. Medians: first
usable content 192 ms, streaming 1,156 ms, paste-to-paint 113 ms, typing 31.6 ms,
paging 32.3 ms, loaded JS heap 34.2 MB. No stale paints were reported.

## Structural-range follow-up validation

The full suite passed 204 tests with three existing concurrency skips. After the
final sibling-removal batching optimization, all 18 structural-range checks passed
in Chromium, Firefox and WebKit, including deleting and undoing 1,024 atoms in one
removal step. The existing navigation checks passed at desktop and narrow widths.
The final production build, TypeScript, ownership checks and targeted lint passed.

The [three-trial structural-range benchmark](../artifacts/editor-structural-ranges/baseline.json)
passes every existing budget, including worst-trial checks. Median first usable
content: 193 ms; streaming: 1,156 ms; paste-to-paint: 113 ms; typing: 31.8 ms;
paging: 32.2 ms; loaded JS heap: 34.3 MB. No stale paints were reported.

## Durable mixed ranges and external comments

The core now captures and resolves independently serialized `DocumentRange` endpoints for text,
node, mixed and all-document selections. Structural deletion neighbours share the existing revision
checkpoint; there is no range registry. Whole-node comments follow moves, split/join and unwrap.
Deleting endpoint paragraphs retains an interior image; deleting all covered content reports deletion.
Undo and checkpoint reload recover references without depending on runtime IDs.

The comment extension uses the public API. The app projects whole-node decorations into its rendered
blocks and text highlights. Image comments open in the existing reply panel, and opening them does
not overwrite a Shift-click selection. Interactive descendants keep their own behavior.

Validation: the full Chromium/Firefox/WebKit suite passed 222 tests, with the three existing
concurrent split/insert convergence skips. After sharing the mapping-index shortcuts with the new
resolver, 111 focused range/foundation tests passed with the same three skips. Those checks include
exact-replay comparisons, both text associations, deletion, undo, checkpoint reload, and replica
agreement after the same accepted revision sequence. They do not establish concurrent OT convergence.
The production build and ownership checks passed. New modules and changed app modules pass Oxlint;
existing compressed core modules still have unrelated baseline lint findings.

Performance reports are in `artifacts/editor-durable-ranges`. The benchmark uses three serial trials
with fresh browser contexts and measures Warbreaker loading, rich paste, typing, paging and loaded JS
heap. It does not bound retained checkpoint size or establish many-comment performance after extensive
structural deletion histories.

Final three-trial performance budgets passed on the completed change. Medians: first usable paint
195 ms, streaming 1177 ms, paste handler 53.7 ms, paste-to-paint 117.2 ms, typing-to-frame 32.1 ms,
paging-to-frame 32.0 ms, loaded JS heap 34.24 MB. All worst-trial values stayed below the existing
budgets. No stale paints were reported.

## Rich rectangular table clipboard

Table clipboard events now use the shared starter-kit adapter. Copy produces cropped rich HTML,
local fragments and quoted TSV in visual order. Paste preserves supported rich cell content and
header formatting, uses the source rectangle size, grows unmerged tables at their edges and leaves
other cells intact. Row-batched steps preserve destination cell identities and form one undo entry.
Copying through a partial merged cell and pasting merged grids reject explicitly.

Validation: 237 browser tests passed across Chromium, Firefox and WebKit; the three existing
collaboration-convergence skips remain. The 15 table-specific checks cover reversed rectangles,
empty and multiline cells, external HTML, formatting, UI copy/paste/cut, single-step undo/redo,
permission rejection without partial edits, merged-cell boundaries and a 1,024-cell paste expanding
a 24×24 table to 52×52. Production build, ownership checks, changed adapter/new command lint and
`git diff --check` passed.
