# Accessible reading and native text input

The document model remains authoritative. Canvas owns visual layout; the view
owns a native textarea editing bridge and an optional semantic reading projection.
React is optional and no `contenteditable` is used.

```ts
const view = mountEditor(element, {
  editor,
  accessibility: {
    label: 'Draft document',
    description: 'Press Escape then Tab to leave text editing.',
    readingView: true,
  },
});

// These settings update without replacing the view or native input.
view.update({ accessibility: { label: 'Final document' } });
```

`EditorContent` accepts the same `accessibility` prop. Unlike imperative
`view.update` patches, React props are complete declarative settings: omitted
fields revert to the exported `defaultAccessibility` values. The input is a normal Tab
stop once the view is ready. Escape then Tab bypasses structural Tab commands.
Native caret/selection changes map back to grapheme-safe model positions. Read-only
content remains readable; protected text is omitted from capture and projection.

## Extension descriptions

Browser extensions contribute semantic descriptions independently of their canvas
presentation or custom React renderer:

```ts
import { defineNodeAccessibility, nodeAccessibility } from '@kerned/view';

// Inside an extension's setup callback; chapter is its schema definition.
context.provide(
  nodeAccessibility,
  defineNodeAccessibility(chapter, (attributes) => ({
    kind: 'heading',
    level: attributes.level,
  })),
);
```

The definition binds to its installed, configured schema family. Duplicate
semantic descriptions for a node type are rejected. Descriptions support text,
heading, group, quote, list, list-item, image and table/cell semantics. The starter
browser extensions supply descriptions for their own definitions. The view does
not recognize paragraph, heading or table names itself.

Permissions are checked before invoking descriptions or traversing descendants.
Descriptions cannot inject HTML, fetch resources or install controls. Inline
alternatives use the schema's plain-text representation. Native interactive
controls remain in their existing node/inline views.

## Reading and editing

The optional reading section exposes the entire **loaded** document independently
of canvas viewport culling. Headings, list relationships, image alternatives and
table spans are native semantic DOM. Clicking or activating an editable text
block selects its beginning and focuses the editor's existing input. Read-only
blocks cannot activate editing. Text blocks do not each add a Tab stop.

The projection preserves element identity where possible and ignores selection
and stored-mark updates. Document and permission changes refresh it. Disabling
`readingView` releases its DOM and cache. The default is `false`: this initial
complete-document strategy is not yet measured or paginated for book-sized input.
The demo enables it for small samples, not streamed books.

## Validation limits

Automated Chromium, Firefox and WebKit tests cover semantic structure, permission
revocation, custom definitions, native selection, keyboard entry/exit and Chinese
composition event sequences with undo/redo. Synthetic events do not validate an
operating system's IME candidate UI. Native testing was blocked by a locked Mac.

Before claiming screen-reader compatibility, test VoiceOver/Safari and
NVDA/Firefox/Chromium for heading/table navigation, character reading, editing,
selection, toolbar focus and composition. Record versions and observed behaviour.
Rich mark announcements, cross-block native selection, accessible text geometry
for magnification/braille routing, and large-document reading are still open.
The projection currently activates the beginning of a block, not a screen-reader
word position. It does not duplicate custom interactive controls.

The architectural review fixes keep composition ownership inside the native input
module: moving selection away discards the old candidate, and a new composition
cancels the previous deferred callback. Mounted and React tests cover both cases
and removing accessibility props without remounting.
