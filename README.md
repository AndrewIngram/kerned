# gprose

See the [target repository map](docs/repository-map.md) for the pnpm workspace
layout and package migration, including the lint and test guarantees to preserve.

A canvas text editor with a schema-independent editing core and React extensions.
The examples below use source imports from this repository.

The planned consumer interface and package migration are specified in the
[public-interface implementation plan](docs/public-interface-implementation-plan.md).
Its proposed APIs are not yet implemented; the examples below describe current usage.

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

## Create editor state

`createEditor` owns document state, selection, transaction history, and search.
It does not create a view. A custom host can start with the existing document
schema:

```ts
import { createEditor, textSelection } from './src/state';
import type { Step } from './src/transform';
import { demoSchema } from './src/extensions/demo-schema';
import { tableCells } from './src/extensions/table';
import type { StarterNode } from './src/extensions/demo-model';

const editor = createEditor(
  demoSchema,
  [
    {
      kind: 'paragraph',
      id: 1,
      key: 'intro',
      text: 'Hello world',
      marks: [],
      inline: [],
    },
  ],
  textSelection(1, 0),
  [tableCells.extension],
);
```

`editor.state` contains `nodes`, `selection`, and `revision`. Each node has a
numeric `id` for local operations and a stable string `key` for saved references.
The schema defines its remaining fields. The fourth argument registers custom
selection types, here the table extension's cell selection.

The page host above owns its own editor instance. This example creates a separate
instance for a custom host.

## Run commands

Commands return transaction steps. Create commands from the current state, then
apply their steps with `editor.dispatch`:

```ts
import { textCommands } from './src/extensions/text-commands';

function dispatch(steps: readonly Step<StarterNode>[]) {
  return editor.dispatch({
    baseRevision: editor.state.revision,
    origin: 'local',
    history: 'separate',
    time: performance.now(),
    steps,
  });
}

editor.select(textSelection(1, 0, 5));
dispatch(textCommands(demoSchema, editor.state).toggle('bold'));

dispatch([{ kind: 'replaceText', id: 1, from: 5, to: 5, text: ' canvas' }]);

editor.undo();
editor.redo();
```

The paragraph now reads `Hello canvas world`, with `Hello` in bold. The host
updates its view after dispatch, selection changes, undo, or redo. `dispatch`
returns the new `state` and `changedIds`; undo and redo return `null` when their
history is empty. There is no state subscription API.

Text offsets use UTF-16 positions and must follow grapheme boundaries. A stale
`baseRevision` rejects the transaction. `history: 'separate'` creates an undo
boundary; `history: {group: 'typing'}` allows compatible adjacent edits to group.

| Operation                       | API                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Caret or range within one block | `editor.select(textSelection(id, from, to))`; omit `to` for a caret                                     |
| Range across blocks             | `editor.select(new TextSelection(anchor, head))`; each endpoint is `{id, offset}`                       |
| Bold, italic, underline         | `textCommands(schema, state).toggle('bold' \| 'italic' \| 'underline')`                                 |
| Toolbar state                   | `textCommands(schema, state).available` and `.active(format)`                                           |
| Clear formatting                | `textCommands(schema, state).clear()`                                                                   |
| Comment on selected text        | `textCommands(schema, state).comment(id)` returns `{steps, target}`                                     |
| Quote or list                   | `blockCommands(schema, state, ids, allocate).quote()` or `.list(ordered)`                               |
| Paragraph or heading            | `setTextBlockType(schema, state, ids, level)`; `level` is `1`, `2`, `3`, `4`, or `null` for a paragraph |

Formatting commands require a nonempty text selection. Block commands receive
selected block IDs and an `allocate` function returning a fresh `{id, key}`.
Use `editor.allocateBlockId()` for the ID and a unique stable key of your choice.

The command implementations live in
[`text-commands.ts`](src/extensions/text-commands.ts),
[`blocks.ts`](src/extensions/blocks.ts), and
[`headings.ts`](src/extensions/headings.ts). The
[transaction reference](docs/editor-transactions-and-anchors.md) covers structural
steps, streamed appends, history grouping, and durable anchors.

## Define a node extension

Define content independently of rendering. The extension name identifies the node
kind; its synchronous Standard Schema validator describes attributes and defaults.
The editor generates text editing, mark mapping, child traversal and persistence
from the definition.

```ts
import { z } from 'zod';
import { createSchema, defineNode } from './src/model';
import { createEditor, textSelection } from './src/state';

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
const result = schema['~standard'].validate([{ kind: 'note', key: 'first-note', text: 'A note' }]);
if (result.issues) throw new Error('Invalid content');
const notes = createEditor(schema, result.value, textSelection(result.value[0].id, 0));
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
headings, checklists, images, tables, quotes, lists, formatting and mentions.
The object-configured session and extension command APIs remain scheduled for
milestone 3; the example above uses the current imperative session constructor.

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
