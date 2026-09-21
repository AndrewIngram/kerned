# Editor app ownership

The writing demo and extension study are two routes of one Vite React app. Both
HTML files load `src/demo/app/main.tsx`. The entry loads engine assets and the
initial sample, then mounts `App`. React Fast Refresh handles component updates.
Run `npm run demo` to open the writing route.

## What belongs where

| Owner | Responsibility |
| --- | --- |
| `src/editor` | Schema-independent state, transactions, selections, text navigation and selection projection |
| `src/editor-browser` | Native event routing, input capture, pointer/multiclick policy and keyboard navigation binding |
| `src/editor-react` | Optional subscriptions and DOM/input/viewport lifecycle hooks |
| `src/editor-canvas` | CanvasKit surface lifetime, registered painters, selection/highlight/caret drawing and frame scheduling |
| `src/extensions/starter-kit` | Paragraph/list/quote/table commands, schema projection, incremental layout and React block rendering |
| `src/demo/app` | Sample switching and loading, toolbar presentation, external comment UI, search UI, outline and diagnostics |

The headless core imports neither React nor browser code. Browser, React and
canvas adapters do not import a particular schema. Starter-kit code cannot import
app code, sample loaders, demo styles or benchmark fixtures. These rules are
checked by `npm run check:app-boundaries`, which also runs during the build.

## How to follow an edit

```text
native pointer/key/input event
  -> editor-browser / editor-react input adapter
  -> starter-kit command (for schema-specific editing)
  -> editor transaction / selection
  -> useEditorDocument: one indexed snapshot
  -> useDocumentLayout: reuse or update affected layouts
  -> canvas renderer and React BlockLayer
```

`EditorWorkspace` is the demo composition point. It creates a session and connects
these owners; it does not implement text navigation, canvas painting or structural
editing. Its toolbar receives the document snapshot and command surface. Comment
threads remain separate from document state.

A custom renderer can use `createTextInteraction().bind(...)` with its own text
and line geometry. A React canvas host uses `useCanvasInput`, which also owns
textarea synchronization, native Select All, composition lifecycle, and caret
reveal. Neither requires the demo's paragraph/heading model.

## Lifetime and performance constraints

- `App` owns sample navigation. It unmounts the old workspace before reusing the
  shared engine for another sample. Fonts and imported source data stay resident.
- The workspace owns the editor session. Each mounted canvas renderer owns its
  surface and paint object. Unmount cancels its scheduled frame and releases both.
- The starter-kit layout hook owns the scene cache and background reflow work.
  All command queries share `useEditorDocument`'s index; they must not rebuild a
  tree for every toolbar button.
- The input adapter positions its hidden textarea beside the visible caret.
  Moving it to the top of the document makes native typing scroll to the origin.
- `useSampleStream` owns append scheduling and cancels pending work on unmount.
  Its batch controller uses new composition time, not total document bookkeeping.
  Layout and paint observers report metrics; the rendering modules do not know
  about sample progress or benchmark thresholds.
- `useDiagnostics` is the only app module that imports the correctness fixtures.
  It preserves the existing `window.editorDiagnostics` interface for browser checks.

## Design decision

Two designs were considered:

```text
A: App -> many demo hooks -> core
   App continues to own keyboard policy and renderer lifetime indirectly.

B: App -> reusable browser/React/canvas adapters + starter-kit extensions -> core
   Each package owns its behavior and cleanup; the app supplies data and UI.
```

We chose B. A would shorten the entry file but keep editor behavior tied to the
demo. A new all-purpose controller/context was also unnecessary: existing session,
schema and renderer interfaces already supply the seams. This refactor keeps
those APIs and introduces focused adapters instead of a second state store.

This is not a zero-configuration packaged rich-text widget. The demo still
assembles a concrete canvas host, and the starter kit still uses the experimental
owned layout engine. Production collaboration, persistence migrations and broader
script shaping remain separate work.

## Validation of this refactor

The full browser suite passed 168 cases, with the three existing concurrent
split/insert cases still skipped. A subsequent focused run passed 48 cases,
including the new foreign-schema selection/multiclick regression in all three
browsers. Navigation, sample switching without reload, search and 2,000/10,000-block
checks also passed across Chromium, Firefox and WebKit. The refactored modules
pass Oxlint, and the production build passes both ownership-boundary checks.

The [three-trial development benchmark](../artifacts/editor-app-refactor/baseline.json)
passes all existing performance budgets. Medians: first usable 192 ms, book load
1,199 ms, rich-paste handler 52 ms, paste-to-second-frame 116 ms, typing 32 ms,
paging 32 ms. Load and paste-to-paint are higher than the previous recorded
1,003 ms and 102 ms, respectively; this is a maintainability change, not a claimed
performance improvement. Vite's React development plugin is now enabled, so the
development environment also differs. No runtime dependency was added.

The [second audit](editor-adapter-audit.md) records adapter lifecycle fixes, shared
input indexing, the command/input separation, and selection identity fixes.

## Atomic node interaction

Node renderers opt into selection with `data-editor-node={node.id}` on their
non-text surface. The browser adapter checks the current schema's `selectable`
contract before selecting it. Native interactive descendants retain their own
pointer handling, and the existing `data-editor-interactive` escape hatch applies.
Text annotations retain `data-editor-text-hit` behavior.

`moveNodeSelection` consumes a renderer-provided ordered list of text and atomic
nodes. Plain arrows stop on selectable atoms, skip nonselectable atoms, and leave
a node selection at the nearest adjacent text boundary. The browser adapter uses
`textBoundaryNearNode` to seed the existing word, line, document-edge and page
navigator for modified movement. Keyboard selection changes reveal the selected
node within the viewport as well as revealing text carets.

`RangeSelection` adds text-offset and before/after-node endpoints. Shift-arrow,
Shift-click and dragging can include atoms at either document edge, even when the
document contains only atoms. Reversing an extension removes one atomic boundary
at a time; an unmodified arrow collapses a range toward that direction. A collapsed
structural endpoint accepts insertion through the starter-kit schema adapter.
Select All uses structural endpoints when a document starts or ends with atoms.

The range model lives in `editor/range-selection.ts`; the base selection protocol
is in `editor/selection-base.ts`. Ranges emit maximal whole-node fragments plus
partial text fragments, without overlapping descendants. This lets rendering,
formatting and clipboard code consume the existing selection protocol. Tables
still use their separate cell-selection extension for disjoint rectangular ranges.

Endpoint bookmarks map through transaction changes, including split/join and
removed ancestors. The selection codec stores stable node keys and text offsets
for a document snapshot. It is not an independently durable external reference:
comments and other references stored outside the editor must continue to use the
existing relative-position and relative-gap APIs. Derived endpoint ordering
numbers are temporary and must not be persisted.

Validation of node interaction: production build and boundary checks passed; the
full browser suite passed 189 tests with three existing skips. The navigation
script passed at 1100 px and 390 px in Chromium, Firefox and WebKit, including
modifier keys, shift/drag, paging and distant document boundaries. Performance
benchmarks above predate this interaction change.

## Durable document ranges

`editor.positions.captureRange(selection)` converts a contiguous selection into independently
serializable endpoints. `resolveDocumentRange(range)` resolves them to text slices and whole nodes.
The discussion extension uses that API through `captureComment(editor, id, messages)` and
`resolveRangeDecorations`; it owns neither mapping history nor schema fields.

`document-ranges.ts` owns the wire types, parser, selection capture and range decomposition.
`relative-boundaries.ts` owns structural deletion neighbours and boundary mapping.
`relative-positions.ts` shares revision indexing, undo cancellation and checkpoint persistence
between existing text positions and the new document ranges. `transactions.ts` records surviving
edges when removing nodes. Renderers receive snapshot fragments, never replay mapping history.

Two alternatives were rejected: registering each comment range in the editor would couple external
feature storage to document state; resolving only against current neighbouring node keys would lose
ranges after both neighbours were deleted. Retaining structural deletion metadata in the existing
revision checkpoint keeps references independent and lets a surviving image retain a comment even
when both original text endpoints are removed.

The range is a contiguous interval in the current document order. Interior insertions are included;
text edge insertions are excluded by the capture associations. Deleted boundaries shrink inward.
Reversed endpoints or no remaining covered content resolve as deleted. Rectangular cell selections
remain a separate extension concern and are not coerced into contiguous ranges. The API assumes an
accepted revision order, and does not itself solve concurrent operation transformation.

## Rectangular table clipboard

The table selection extension exposes logical rectangle bounds. `table-clipboard.ts` uses that
geometry to crop rich cells, serialize quoted TSV and construct row-batched paste steps. It owns
table expansion and source-sized replacement policy. Existing cells retain their identities;
inserted content receives new identities. Core transactions enforce permissions and atomic undo.

`clipboard.ts` retains the local-fragment/HTML boundary. The starter-kit input adapter dispatches
rectangle commands for cell selections and table fragments pasted at cell text carets. `TableBlock`
forwards clipboard events to those shared handlers instead of implementing its own plain-text path.
Neither core nor the command module depends on React or a rendered table.
