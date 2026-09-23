# Document outline extension

`createOutlineExtension(schema, heading)` in `@kerned/extension-outline` derives
an outline using the editor's public schema API. The adapter returns a heading's
level and plain-text title, or `null`. The extension has no dependency on the
demo schema, React, canvas or DOM elements.

`read(nodes)` returns entries in document order with `id`, stable `key`, `title`,
`level`, `depth` and `parentKey`. The nearest preceding lower-level heading is
the parent. Skipped levels do not create empty parents. Duplicate and empty
titles retain their separate identities. Entries are derived data; persistent
text locations can still use the editor's existing anchor API.

Nodes must be immutable. A weak cache retains extracted headings per subtree,
and repeated reads of the same root array return the same result. Edits and
streamed content update the outline; scrolling only looks up heading positions
in the layout snapshot.

The minimal demo displays a right-edge rail. Hover, focus or tap opens its
scrollable outline, replacing the marks without a title bar. Selecting an entry scrolls without changing the editor
selection or adding history. Escape and outside clicks dismiss it. On narrow
screens a compact button replaces the rail; touch navigation closes the menu.
The rail is vertically centered below the toolbar and uses at most 80% of the
available height. Marks remain 10px apart, with hidden overflow and internal
scrolling to keep the active mark visible. No headings means no menu. The active entry follows the current section.

Run `pnpm run check:editor-outline` for generic-schema extraction, nested and
skipped levels, cached edits, streamed roots, editing/undo and browser navigation.

For a fully available source loaded into the editor in chunks, `read(nodes,
pending)` appends pre-extracted pending entries and recalculates the combined
hierarchy. Warbreaker extracts these entries before first paint without text
layout. Each source heading records its root index. Only headings beyond the
source ingestion cursor are merged, so edits or deletions to loaded headings
cannot resurrect stale source entries. The view greys out pending entries and
rail marks, disables their navigation, and enables them once a scene placement
exists. Off-screen headings remain navigable through viewport culling.
