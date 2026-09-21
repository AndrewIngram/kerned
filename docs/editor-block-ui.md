# Block editing in the minimal demo

The toolbar uses the compact Blocks menu. Underline and clear formatting operate
on the selected text; comments can span canvas paragraphs. Comment replies update
all ranges belonging to the same comment. These commands return ordinary steps
from `extensions/text-commands.ts`, with no UI or core schema dependencies.

Quotes, lists and list items are container extensions. Paragraph identities survive
wrapping, unwrapping, indentation and outdentation. The view projects container
content into positioned leaves for the existing viewport layout and shaping cache.
Quote indentation and list markers are view decorations. Text, hit testing,
selection rectangles and caret positions share the same translated layout.

The list extension owns wrapping, nesting, Enter, empty-item exit and Backspace.
Tab and Shift+Tab indent/outdent. Toggling the current list type removes its wrapper;
choosing the other type changes its markers. Quote toggling unwraps the containing
quote. Enter on an empty quote paragraph exits the quote.

Tables register as containers with identified cells and paragraph children, including
imported HTML tables. The existing cell-selection extension supplies rectangular
ranges, serialization and history bookmarks. Click a cell's content to edit; Tab
moves between paragraphs/cells. Corner controls select a cell; Shift-click another
corner extends a rectangle. Delete clears the selected cells. Toolbar formatting
also operates on selected cell ranges. New tables are 3 by 3 with a header row.
Rows and columns can be appended from Blocks while a table is active.

## Current limits

- Table text uses a React DOM display and textarea editing surface. Canvas text
  remains the renderer for paragraphs, quotes and lists. There is no contenteditable.
- Row/column insertion supports unmerged tables. Imported colspan/rowspan data is
  preserved; merging, splitting and deleting rows/columns have no commands yet.
- Rectangular clipboard supports rich HTML, local fragments and TSV, with table expansion
  and atomic undo. Pasting merged grids remains unsupported; see `clipboard.md`.
- Comments are currently exposed for canvas text, not table cells.
- Structural replacement handles quote/list boundaries but is not a general rich
  slice/paste algorithm. Arbitrary schema joins still need extension policy.
- Formatting requires a nonempty selection; stored marks for future typing are absent.

## Verification

`check:editor-blocks` and `check:editor-tables` exercise real interactions in Chromium,
Firefox and WebKit at 1100px and 390px. Coverage includes list nesting/exit commands,
quote and cross-container replacement, formatting, comments, cell editing, Tab,
rectangular selection, deletion, row/column addition, and undo. `check:text-commands`
checks range-preserving marks/comments against the transaction API. Existing
transaction, selection, sample-navigation and imported-table checks also apply.
