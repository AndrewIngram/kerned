# Rich clipboard

The demo clipboard adapter in `src/extensions/clipboard.ts` uses public schema,
selection and transaction APIs. Copy writes plain text, semantic HTML and an
opaque local-fragment token. Paste prefers a known local fragment, then imports
HTML in an inert template, then falls back to plain text.

HTML preserves paragraphs, heading levels, bold/italic/underline, nested lists,
blockquotes and tables. Supported inline CSS marks are also imported. Incoming
source identities are replaced, so repeated pastes cannot duplicate block IDs.
Inline insertion uses split/join transactions to map surviving positions, and
each paste creates one history entry.

Local fragments retain the extension model, including mentions, comments,
images and checklist data. The page retains up to eight immutable fragments;
unknown or expired tokens use HTML instead. Custom extension data is therefore
not yet portable across reloads or separate tabs. In exported HTML, mentions
become their labels, images their alternative text and checklists their notes.
Comments are not exported. Portable extension serialization remains separate
work. Table-cell clipboard controls still use their existing plain-text path.

Run `npm run check:editor-rich-paste` for local and HTML round-trips, nested
blocks, partial inline formatting, undo/redo and the complete Warbreaker book
in Chromium, Firefox and WebKit. `npm run check:editor-book-paste` covers the
plain-text fallback.

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
npm run check:editor-id-allocation
npm run check:editor-paste-reflow
BROWSERS=chromium,firefox,webkit npm run benchmark:editor-paste
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

| Browser | Paste handler | First frames | Complete offscreen layout |
|---|---:|---:|---:|
| Chromium | 52 ms | 105 ms | 1.66 s |
| Firefox | 79 ms | 167 ms | 3.31 s |
| WebKit | 44 ms | 87 ms | 1.63 s |

## Native Select All

The host handles Cmd/Ctrl-A when the document, page, or toolbar has focus.
Find, table-cell editors, and other native text controls keep their own text
selection. Safari can also invoke Select All directly on the hidden capture
textarea without delivering the expected keydown. A native `select` listener
promotes that selection to the editor document. It ignores selection writes
already mirrored from the model, preserving deliberate paragraph selections.

`npm run check:editor-select-all` covers both keyboard and native selection
paths. The Safari fix was also verified in the actual desktop browser by
clicking document text, pressing Cmd-A, and inspecting the canvas highlights.
