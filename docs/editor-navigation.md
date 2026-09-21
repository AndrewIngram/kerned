# Pointer and keyboard navigation

Navigation is part of the editor APIs, independent of the demo's schema.

`hitTestTextLines` from `src/editor` accepts text regions in document coordinates.
It finds the nearest rendered line vertically, then asks that line's layout for
the nearest character at the pointer's x coordinate. This also applies to gaps,
gutters, and positions above or below the content. A renderer must supply the
nearby layouts even when it culls off-screen content.

`usePointerSelection` from `src/editor-react` supplies event handlers for the
whole editor surface. The host supplies coordinate conversion, hit testing,
selection updates and input focus. Shift-click and dragging preserve the anchor.
A callback can supply word/block ranges for multiple clicks. Native interactive
controls are excluded; custom interactive extensions use
`data-editor-interactive`. Non-atomic text decorations can use
`data-editor-text-hit` to retain normal text placement.

`createTextNavigation` from `src/editor` handles arrows, Home/End, Page Up/Down
and Shift selection. It retains the desired horizontal position across vertical
movement, including short lines and block boundaries. The host supplies ordered
text blocks, layout hydration, viewport height and the platform. Mac Option
moves by word/paragraph; Command moves to line/document edges. Other platforms
use Control for words, paragraphs and document edges. Modified Page keys are
left to the browser. Pointer selection resets the desired column.

The host remains responsible for scrolling the resulting caret into view.
Embedded DOM editing controls retain their own native keyboard behaviour.

Run `pnpm run check:editor-navigation` for core API contracts and browser checks
at wide/narrow widths, including paging through a virtualized book.
