# gprose

See the [target repository map](docs/repository-map.md) for the pnpm workspace
layout and package migration, including the lint and test guarantees to preserve.

A canvas text editor with a schema-independent editing core and React extensions.
The examples below use source imports from this repository.

The planned consumer interface and package migration are specified in the
[public-interface implementation plan](docs/public-interface-implementation-plan.md).
Schema assembly and composed session commands are implemented. The complete mounted
view, React integration and built package interfaces remain in the plan.

## Add the editor to a page

The current canvas host mounts into `#root` when its module loads. Serve this page
as `/editor.html` through Vite:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My editor</title>
  </head>
  <body data-demo="minimal">
    <div id="root">Loading editor…</div>
    <script type="module" src="/src/demo/app/main.tsx"></script>
  </body>
</html>
```

The Vite entry loads engine assets and the initial sample, then mounts the React
app. The app owns sample navigation; the editor packages own selection, input,
commands and rendering. Both `/editor.html` and `/extensions.html` use this app.

See [editor app ownership](docs/editor-app-architecture.md) for the module map,
execution flow and lifecycle constraints. The optional React `Editor` component
mounts native event handling around a caller-supplied renderer; it does not select
a schema or create a document session for you.

## Create an editor session

Assemble the extensions once, then create a session from that schema. The starter
kit installs content types, editing commands, table selections and local history.
The session works without React or a mounted view.

```ts
import { createEditor } from './src/core';
import { createSchema } from './src/model';
import { textSelection } from './src/state';
import { starterExtensions } from './src/extensions/starter-kit';

const schema = createSchema({ extensions: starterExtensions });
const editor = createEditor({
  schema,
  content: [{ kind: 'paragraph', id: 1, key: 'intro', text: 'Hello world' }],
});
```

`editor.state` exposes readonly document nodes, selection, revision and stored
marks. Each node has a numeric `id` for local operations and a stable string
`key` for saved references. The assembled schema validates content and supplies
missing defaults and identities. Selection types come from the installed
extensions.

The page host above owns its own editor instance. This example creates a separate
instance for a custom host.

## Run commands

```ts
editor.select(textSelection(1, 0, 5));
editor.commands.toggleFormat('bold');
editor.select(textSelection(1, 5));
editor.commands.insertText(' canvas');
editor.commands.undo();
editor.commands.redo();

const available = editor.can().toggleFormat('italic');
const activity = editor.getCommandState('toggleFormat', 'bold');
// Connect your persistence callback to committed content changes.
const unsubscribe = editor.on('content', ({ after }) => save(after.nodes));
```

The paragraph now reads `Hello canvas world`, with `Hello` in bold. Commands return
whether they succeeded. `can()` checks the same command without publication.
Availability is separate from active, inactive or mixed formatting. Named methods
and argument types derive from the installed extensions.

`editor.chain().focus().toggleFormat('bold').scrollIntoView().run()` combines
commands into one undoable edit and defers view effects until successful
publication. Headless focus/reveal are no-ops. A false command rejects the entire
chain. History replay may accompany view effects or read-only commands; invoke
new edits and undo/redo as separate calls.

Use `editor.on(...)` for typed content, transaction, selection and destruction
events, or `editor.subscribe(...)` for view invalidation. Both return cleanup.
`editor.destroy()` releases the attached view and extension resources. It leaves
the final snapshot readable and rejects subsequent edits.

| Operation                       | Interface                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Caret or range within one block | `editor.select(textSelection(id, from, to))`; omit `to` for a caret            |
| Range across blocks             | `editor.select(new TextSelection(anchor, head))`; endpoints are `{id, offset}` |
| Bold, italic, underline         | `editor.commands.toggleFormat(format)`                                         |
| Clear formatting                | `editor.commands.clearMarks()`                                                 |
| Quote or list                   | `editor.commands.toggleQuote()` or `.toggleList(ordered)`                      |
| Paragraph or heading            | `editor.commands.setHeading(level)`; `1`–`4`, or `null` for a paragraph        |
| Table                           | `editor.commands.insertTable()`, `.addTableRow()`, `.addTableColumn()`         |

Caret formatting applies to subsequent input without changing existing content.
Comments are external extension data based on durable ranges; see
[the session reference](docs/editor-session-api.md#external-comments-and-decorations).

The imperative `editor.transact(context => ...)` and `editor.dispatch(transaction)`
interfaces remain available beneath named commands. Text offsets use UTF-16
positions at grapheme boundaries. Stale revisions reject. See the
[session reference](docs/editor-session-api.md) for extension authoring and chain
semantics, and the [transaction reference](docs/editor-transactions-and-anchors.md)
for steps, streamed appends, grouping and durable references.

## Define a node extension

Define content independently of rendering. The extension name identifies the node
kind; its synchronous Standard Schema validator describes attributes and defaults.
The editor generates text editing, mark mapping, child traversal and persistence
from the definition.

```ts
import { z } from 'zod';
import { createSchema, defineNode } from './src/model';
import { createEditor } from './src/core';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

const schema = createSchema({ extensions: [note] });
const notes = createEditor({
  schema,
  content: [{ kind: 'note', key: 'first-note', text: 'A note' }],
});
```

Content types derive from the installed extension tuple. Validation assigns missing
identities and returns immutable content. Attribute validators may normalize
imports; edits preserve position mappings and reject text-changing normalization.
For transformations whose output cannot be parsed unchanged by the input schema,
provide `outputAttributes` as a canonical validator. Edits and persistence check
that validator without normalizing values again.

Zod is used here as a Standard Schema implementation; it is not required in an
extension author's code.

Use `content: { kind: 'atom' }` for an object without editable text, or
`content: { kind: 'container', field: 'children' }` for nested nodes. Containers
can restrict children by explicit names or installed groups. The starter kit's
blockquote accepts the `block` and `list` groups, so it works in a small kit
without requiring tables or images. `defineMark` and `defineInline` add typed
formatting and inline objects to the same assembly.

The [starter definitions](src/extensions/starter-definitions.ts) own paragraphs,
headings, images, tables, quotes, lists, formatting and mentions.
The [session reference](docs/editor-session-api.md) describes the object-configured
session, reusable commands, queries and per-session extension state.

## Render extensions

Node registration adds editing behavior. The host supplies canvas or DOM views
for those nodes. React components can register canvas paint callbacks with
`CanvasPrimitive`:

```tsx
import { useCallback } from 'react';
import { CanvasPrimitive, type CanvasPainter } from './src/editor-react';

function Highlight() {
  const paint = useCallback<CanvasPainter>((canvas, kit, brush) => {
    brush.setColor(kit.Color(255, 236, 153));
    canvas.drawRect(kit.XYWHRect(0, 0, 120, 28), brush);
  }, []);

  return <CanvasPrimitive id="example-highlight" layer="background" paint={paint} />;
}
```

The host wraps these components in `CanvasLayerProvider`. Its `value` is a
`register(id, painter, layer)` function that returns an unregister callback. The
host invokes registered painters during its viewport drawing pass.
`CanvasPrimitive` unregisters on unmount. Layers are `background` and `content`.

Inline objects use `InlineObject<Data>` and an `InlineExtension<Data, Layout>`
with `plainText` and `layout` functions. Range annotations use
`RangeAnnotation<Data>` and the core's replace, slice, and join helpers. The
[mention](src/extensions/mention.ts) and [comment](src/extensions/comment.ts)
extensions show both patterns; the text node's editing methods keep their ranges
in sync. See [React integration](docs/react-extensions.md) for DOM controls,
measurements, portals, and focus.

## Run this repository

Use Node 22.12 or later, pnpm 10.14.0 (pinned in `packageManager`), and Rust 1.93.1 or later:

```sh
rustup target add wasm32-unknown-unknown
pnpm install --frozen-lockfile
pnpm run setup
pnpm run demo
```

Setup prepares fonts and the shaping bridge. `pnpm run demo:extensions` opens the
extension fixtures. `pnpm run build` produces `dist/`, and `pnpm run preview` serves
it. Run `pnpm exec playwright install chromium firefox webkit` once, then `pnpm test` for
Vitest and the existing Playwright suite. `pnpm run check:project` checks source and
documentation references.

Use `pnpm run test:unit` for Vitest tests in Node, `pnpm run test:browser` for Vitest
Browser Mode in headless Chromium, Firefox, and WebKit, and `pnpm run test:watch`
during development. `pnpm run test:e2e` runs Playwright application journeys and
low-level pointer automation in `tests/e2e/`. Vitest discovers `*.test.js`,
`*.test.ts`, and `*.test.tsx` in sibling `__tests__` directories under `src/` and
integration tests in root `tests/`; inserting `.browser` before `.test` selects
Browser Mode. To select one browser, use
`pnpm run test:vitest --project browser-firefox` (or `browser-chromium` /
`browser-webkit`).

Run `pnpm run format` to apply Oxfmt formatting and import sorting, or
`pnpm run format:check` to check formatting without changing files. Run
`pnpm run check` for lint, formatting, typecheck, project checks, and all tests.
