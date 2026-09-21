# Editor Find

Find belongs to the editor API; its UI belongs to the host. The demo uses a floating bar opened by the toolbar search button or Cmd/Ctrl+F. Enter moves forward, Shift+Enter moves backward, and Escape closes it. Next and previous wrap around. The bar retains the last query when reopened.

```ts
const editor = createEditor(schema, nodes, selection);

editor.find.setQuery('Breath');
editor.find.setQuery('Breath', { matchCase: true });
editor.find.next();
editor.find.previous();

const { matches, active, activeIndex } = editor.find.state;
// active: {id, key, from, to} | null
// activeIndex is -1 when no match exists.

editor.find.clear();
```

`createFind(schema, readNodes)` is also exported for hosts with their own document-state owner. `FindState`, `FindMatch`, `FindOptions`, `FindSnapshot`, and `EditorFind` are public types. Omitting `matchCase` preserves the current option. `state.byNode` groups the same match objects by text-node ID for rendering.

For interactive search on large documents, use the cancellable asynchronous API:

```ts
const controller = new AbortController();
const snapshot = await editor.find.setQueryAsync('Pierre', { matchCase: false }, controller.signal);
if (snapshot) {
  // snapshot.nodes is the immutable document that produced snapshot.state.
  renderResults(snapshot);
}
// controller.abort() cancels pending work without publishing partial results.
```

The promise returns `null` if another query or synchronous command supersedes it, the signal is aborted, or an edit invalidates its document. Append-only loading extends an in-progress search to include the new roots. Results are published only after that search completes.

## Search contract

- Literal, non-overlapping matches within each schema text node, in document tree order. Headings, nested lists, quotes, and table-cell text participate through the schema. Queries do not span separate text nodes. Atom labels, image descriptions, and other non-editable metadata are outside this initial scope.
- Case-insensitive search uses Unicode simple case folding. Case-sensitive search compares exact text. There is no accent folding, normalization, regex mode, or replacement operation.
- Ranges use original UTF-16 offsets and start and end at grapheme boundaries. Searching for part of a combining sequence or joined emoji does not produce an invalid editing range.
- Searching, navigation, and clearing do not change the document, selection, revision, or history. Closing the demo bar restores focus without changing the editing selection.
- Reading state or navigating synchronizes results with the latest immutable document nodes, including edits, undo, redo, and stream appends. A changed query starts at the first match. A document change preserves the current range when possible, otherwise chooses the nearest match in that node, then a surviving result at the previous index.
- There is no independent subscription system. Synchronous hosts read `find.state` after editor changes and Find commands. Asynchronous hosts keep the returned snapshot and request a refresh when the document changes; reading the synchronous getter during render would bypass cooperative scheduling.

## Ownership and performance

A pure matcher with UI-owned navigation was considered. It would leave every host responsible for query options, wrapping, stale results, and current-match continuity. A core Find session keeps those rules in one place while returning plain ranges that any renderer can use.

The core walks schema text without layout or DOM access. It skips work when document identity is unchanged and caches per-node text and matches. Unicode grapheme boundaries are cached as one bit per UTF-16 boundary, avoiding repeated segmentation for every keystroke. Plain ASCII needs no boundary table. Formatting updates reuse results; removed nodes leave the cache. An empty query performs no tree scan. Navigation over an unchanged document is constant time.

Asynchronous search starts in a new task, then yields between roughly 4 ms work slices, including within large paragraphs. This gives input and painting opportunities while scanning. The slice target is cooperative, not a hard deadline. The demo keeps the input draft in urgent local React state, cancels obsolete searches, and commits completed snapshots with `startTransition`. A transition alone cannot interrupt a synchronous matcher: [React calls its action immediately](https://react.dev/reference/react/startTransition).

During append-only loading, an earlier snapshot remains valid for its unchanged document prefix. The demo retains its count and highlights while the next snapshot catches up. New roots do not reset Find, toggle its pending indicator, or repeatedly scroll to the active result. Actual edits invalidate affected snapshots; a changed query displays a pending count and temporarily disables result navigation.

`src/demo/find-bar.tsx` owns controls and input focus. The editor demo consumes `byNode`, paints only mounted canvas paragraphs, and passes cell ranges to the table view. It pins the current result's block before scrolling to its geometry. The scene can reserve top space so the floating bar does not cover the first result; this does not rewrap text. Editing selections remain independent of search highlights.

## Verification

With the local development server running:

```sh
node scripts/check-editor-find-core.mjs
node scripts/check-editor-find.mjs
BROWSERS=chromium,firefox,webkit node scripts/benchmark-editor-find.mjs
BROWSERS=chromium,firefox,webkit node scripts/benchmark-editor-loading.mjs
```

The check scripts exercise Chromium, Firefox, and WebKit. Set `BROWSERS=chromium` to run one engine. The core suite checks nested document order, Unicode ranges, literal queries, case matching, history isolation, cached formatting results, edits, undo/redo, stream appends, and removal of the current match. It also verifies task yields, cancellation, superseded queries, edited-document rejection, and appends during an in-flight search.

The demo suite covers desktop and narrow layouts, keyboard and toolbar controls, actual canvas highlight pixels, table-cell highlights, live editing, undo/redo, first-result visibility, full-book navigation, and navigation after a resize. It saves screenshots and measurements to `artifacts/editor-find*.png` and `artifacts/editor-find.json`.

The performance benchmark uses War and Peace: 11,718 blocks and 3,175,342 characters. It measures input handlers, time to the next animation frame, scheduled rapid typing, and synchronous API costs separately. Before the change, Chromium input handling reached 275.5 ms. Repeated Unicode segmentation accounted for most of the scan cost. After caching boundaries and scheduling search cooperatively, maximum handlers measure 5 ms in Chromium, 2 ms in Firefox, and 1 ms in WebKit. Maximum time to the next animation frame is 16–20 ms. Cold searches still have to build the boundary cache; the asynchronous path distributes that work across tasks.

Reports are in [the baseline](../artifacts/editor-find-performance-before.json) and [the updated benchmark](../artifacts/editor-find-performance-after.json). The streaming benchmark records frames where highlights disappear or counts decrease: both are zero across the two books and three browsers after the fix. See [loading performance](editor-loading-performance.md) for the separate batch-controller correction. These are local development-server measurements, not cross-device latency guarantees.
