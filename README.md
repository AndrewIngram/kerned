# gprose

A canvas text editor with a schema-independent editing core and React extensions.
The examples below use source imports from this repository.

## Add the editor to a page

The current canvas host mounts into `#root` when its module loads. Serve this page
as `/editor.html` through Vite:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<title>My editor</title>
	</head>
	<body data-demo="minimal">
		<div id="root">Loading editor…</div>
		<script type="module" src="/src/hybrid-spike.tsx"></script>
	</body>
</html>
```

The host loads fonts and WebAssembly assets, creates the editor, and mounts its
canvas, toolbar, and React controls. It currently selects the writing view by the
`/editor.html` pathname. A configurable mount function or exported `<Editor>`
component is not available yet.

[`src/hybrid-spike.tsx`](src/hybrid-spike.tsx) is the reference for building your
own host. It connects the APIs below to rendering, input, selection, and focus.

## Create editor state

`createEditor` owns document state, selection, transaction history, and search.
It does not create a view. A custom host can start with the existing document
schema:

```ts
import {createEditor, textSelection, type Step} from './src/editor';
import {demoSchema} from './src/extensions/demo-schema';
import {tableCells} from './src/extensions/table';
import type {HybridNode} from './src/extensions/demo-model';

const editor = createEditor(
	demoSchema,
	[{
		kind: 'paragraph', id: 1, key: 'intro', text: 'Hello world',
		spans: [], atoms: [], comments: [],
	}],
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
import {textCommands} from './src/extensions/text-commands';

function dispatch(steps: readonly Step<HybridNode>[]) {
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

dispatch([{kind: 'replaceText', id: 1, from: 5, to: 5, text: ' canvas'}]);

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

| Operation | API |
| --- | --- |
| Caret or range within one block | `editor.select(textSelection(id, from, to))`; omit `to` for a caret |
| Range across blocks | `editor.select(new TextSelection(anchor, head))`; each endpoint is `{id, offset}` |
| Bold, italic, underline | `textCommands(schema, state).toggle('bold' \| 'italic' \| 'underline')` |
| Toolbar state | `textCommands(schema, state).available` and `.active(format)` |
| Clear formatting | `textCommands(schema, state).clear()` |
| Comment on selected text | `textCommands(schema, state).comment(id)` returns `{steps, target}` |
| Quote or list | `blockCommands(schema, state, ids, allocate).quote()` or `.list(ordered)` |
| Paragraph or heading | `setTextBlockType(schema, state, ids, level)`; `level` is `1`, `2`, `3`, `4`, or `null` for a paragraph |

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

A schema registers node behavior independently of rendering. Each node must match
exactly one extension's `accepts` function. An extension has a unique name, a
positive integer version, and one of three capabilities:

| Kind | Contract |
| --- | --- |
| `text` | Read, replace, split, and join editable text through `editing` |
| `atom` | Treat the node as a block without core-editable text |
| `container` | Read, replace, and validate children through `content` |

This extension gives a custom `Note` node ordinary text editing and undo:

```ts
import {createSchema, createEditor, textSelection, type NodeExtension} from './src/editor';

type Note = {id: number; key: string; kind: 'note'; text: string};

const noteExtension: NodeExtension<Note> = {
	name: 'note',
	version: 1,
	kind: 'text',
	accepts: node => node.kind === 'note',
	validateUpdate() {},
	editing: {
		text: node => node.text,
		replace: (node, from, to, text) => ({
			...node, text: node.text.slice(0, from) + text + node.text.slice(to),
		}),
		split: (node, at, right) => [
			{...node, text: node.text.slice(0, at)},
			{...node, ...right, text: node.text.slice(at)},
		],
		join: (left, right) => ({...left, text: left.text + right.text}),
	},
};

const schema = createSchema([noteExtension]);
const notes = createEditor(
	schema,
	[{kind: 'note', id: 1, key: 'first-note', text: 'A note'}],
	textSelection(1, 0),
);
```

`validateUpdate` checks extension-specific property changes. This plain-text node
has no extra properties to validate. The core enforces identity, editable-text,
and child-list invariants. Extension operations return new nodes and preserve
unchanged content. Rich text extensions also map their formatting, inline objects,
and annotations when text changes.

[`demoStarterKit`](src/extensions/demo-schema.ts) registers the existing
paragraphs, headings, checklists, images, tables, quotes, and lists. Its formatting
and block commands use the `HybridNode` model; a custom schema supplies commands
for its own nodes. See the [extension contracts](docs/editor-extension-boundary.md)
for containers and validation.

## Render extensions

Node registration adds editing behavior. The host supplies canvas or DOM views
for those nodes. React components can register canvas paint callbacks with
`CanvasPrimitive`:

```tsx
import {useCallback} from 'react';
import {CanvasPrimitive, type CanvasPainter} from './src/editor-react';

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

Use Node 22.12 or later and Rust 1.93.1 or later:

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run setup
npm run demo
```

Setup prepares fonts and the shaping bridge. `npm run demo:extensions` opens the
extension fixtures. `npm run build` produces `dist/`, and `npm run preview` serves
it. Run `npx playwright install chromium firefox webkit` once, then `npm test` for
browser checks. `npm run check:project` checks source and documentation references.
