# Rich clipboard

The headless fragment module in `src/extensions/clipboard-fragment.ts` extracts
selected content and prepares paste transactions. The browser adapter in
`src/extensions/clipboard.ts` writes plain text, semantic HTML and an
opaque local-fragment token. Paste prefers a known local fragment, then imports
HTML in an inert template, then falls back to plain text.

HTML preserves paragraphs, heading levels, bold/italic/underline, nested lists,
blockquotes and tables. Supported inline CSS marks are also imported. Incoming
source identities are replaced, so repeated pastes cannot duplicate block IDs.
Inline insertion uses split/join transactions to map surviving positions, and
each paste creates one history entry.

Local fragments retain canonical extension nodes, including custom text fields,
mentions and images. Transfers within the exact same compiled schema retain
immutable node identity without encoding or parsing. Transfers to another schema
use the source codec and validate against the destination schema. Imported HTML
also passes through destination validation before it can become editor content.
The page retains up to eight immutable fragments; unknown or expired tokens use
HTML instead. Custom extension data crosses reloads or separate tabs when the
extension contributes matching HTML serializers and parsers. Starter HTML retains
mention attributes and image sources; plain text uses labels and alternative text.
Comments are not exported. Table-cell controls use the same rich clipboard adapter.

Fragments contain closed, valid trees rather than open ancestor paths. Selecting
text inside one block copies that block's selected content without its ancestors.
When a selection starts in a sublist and continues into an outer sibling, the
selected sublist and the remaining outer list run become separate valid lists.
Unselected parent text and empty placeholder blocks are never added. Partial table
text selections copy the selected text blocks; cell selections use the rectangular
contract below. Complete selected containers retain their structure. Custom
containers must still satisfy their schema when sliced; arbitrary open-fragment
fitting is not implemented. All formats are prepared before clipboard writes, so
serialization failure does not leave only some formats updated.

Run `pnpm run check:editor-rich-paste` for local and HTML round-trips, nested
blocks, partial inline formatting, undo/redo and the complete Warbreaker book
in Chromium, Firefox and WebKit. `pnpm run check:editor-book-paste` covers the
plain-text fallback.

## Rectangular cell clipboard

`@gprose/extension-table` owns schema-specific rectangular copy and paste commands.
The selection extension supplies logical grid bounds, including row/column selections. Copy uses
visual row/column order even when the active cell is the bottom-right corner. It writes a cropped
HTML table, the local rich fragment and spreadsheet TSV. Empty cells remain present; TSV quotes
embedded tabs, newlines and quotes.

Paste starts at the top-left of a cell selection, or at the cell containing a native text caret.
The source rectangle determines the affected area. It expands the table to the right or bottom as
needed, leaves other cells intact, and selects the pasted rectangle. It preserves paragraphs,
headings, marks and local inline extension content. Existing destination cell identities remain
stable; pasted text blocks and inline objects receive fresh identities. The whole operation uses one
transaction and undo entry. Permissions validate the complete result before publication.

Cells accept installed text-block definitions, including custom text nodes as well as paragraphs
and headings. The clipboard reads text, marks and inline labels through schema capabilities rather
than assuming particular field names. Nested lists, quotes and embedded blocks are not
accepted cell content. Copying complete merged cells retains their spans; copying a rectangle that
bisects a merged cell is rejected. Rectangular paste currently requires unmerged source and
destination tables. It never silently falls back to destructive plain text after a rejected rich paste.
Ordinary plain-text paste inside a native cell textarea keeps native text-editing behavior.
Paste and drop input use separate undo entries from surrounding typing in both
native cells and canvas text capture.

Run `pnpm run test:vitest tests/table-clipboard` for Node command tests and browser HTML/TSV
tests in Chromium, Firefox and WebKit. Run `pnpm run test:e2e table-clipboard` for actual
table-view copy, paste, cut and undo journeys.

## Book-size paste

Copying Warbreaker and pasting it at its own end produces 14,560 blocks from
7,280 originals. The original paste handler took 10.55 seconds in Chromium,
and the first frame arrived after 10.95 seconds. A CPU profile attributed
almost all handler time to `allocateBlockId`: it rebuilt the existing
document index for every new block identity.

The allocator now caches occupied IDs for the current immutable document.
Selection changes reuse that cache; edits, stream arrivals, undo, and redo
invalidate it through document identity. The allocation cursor remains
monotonic, so IDs reserved before a transaction are distinct too. A
deterministic regression reduced schema visits for 400 allocations from
162,408 to 404.

Fixing allocation reduced the handler to about 52 ms, but eagerly composing
every inserted paragraph still delayed the first frame to 471 ms. The scene
now composes up to 128 new offscreen paragraphs per build, plus any visible or
pinned paragraphs. Larger insertions enter the existing background-layout
queue. Uncomposed paragraphs carry estimated heights and no glyph geometry;
scrolling promotes them to exact layout before painting. Normal stream
batches remain within the 128-block allowance.

The document insertion and history entry remain atomic. Background work
only fills layout, so subsequent edits, undo, and redo can proceed immediately.
Reading position stays anchored as estimated heights become exact. Full
offscreen layout still takes additional time after the initial response.

Raw measurements are in [the original reproduction](../artifacts/editor-paste-before.json),
[the allocation-only fix](../artifacts/editor-paste-allocation-fixed.json),
and [the final browser benchmark](../artifacts/editor-paste-after.json).
These local development-server runs measure application paste-event handling
and time through two animation frames, excluding synthetic clipboard setup.
They are not browser compositor presentation timestamps or device guarantees.

```sh
pnpm run check:editor-id-allocation
pnpm run check:editor-paste-reflow
BROWSERS=chromium,firefox,webkit pnpm run benchmark:editor-paste
```

The benchmark copies the complete book, pastes it at its end, compares the
resulting semantic HTML with two copies of the original, and checks single-step
undo/redo. It fails above 200 ms for the handler or 250 ms through the first
frames. The layout regression exercises immediate undo, redo, subsequent
typing, resizing, and scrolling into uncomposed text; completed geometry is
compared against an independent eager layout. `PROFILE=/tmp/paste.cpuprofile`
captures a Chromium CPU profile separately from clean timing runs.

The final local runs measured these paste latencies. Offscreen completion
includes the initial response and scheduled frame waits.

| Browser  | Paste handler | First frames | Complete offscreen layout |
| -------- | ------------: | -----------: | ------------------------: |
| Chromium |         52 ms |       105 ms |                    1.66 s |
| Firefox  |         79 ms |       167 ms |                    3.31 s |
| WebKit   |         44 ms |        87 ms |                    1.63 s |

## Native Select All

The host handles Cmd/Ctrl-A when the document, page, or toolbar has focus.
Find, table-cell editors, and other native text controls keep their own text
selection. Safari can also invoke Select All directly on the hidden capture
textarea without delivering the expected keydown. A native `select` listener
promotes that selection to the editor document. It ignores selection writes
already mirrored from the model, preserving deliberate paragraph selections.

`pnpm run check:editor-select-all` covers both keyboard and native selection
paths. The Safari fix was also verified in the actual desktop browser by
clicking document text, pressing Cmd-A, and inspecting the canvas highlights.

The command batches replacements by row rather than issuing one transaction step per cell.
A headless browser check pasting 1,024 cells into a 24×24 table, expanding it to 52×52, measured
about 101 ms in Chromium, 159 ms in Firefox and 80 ms in WebKit in one local run. These are command
construction/application timings, not rendering latency or a stable performance budget. The same
check validates unique identities, all 1,024 selected cells, header formatting and exact undo.
