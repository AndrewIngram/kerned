# Gprose

Gprose is a canvas text editor with a framework-independent editing core and an
optional React integration. Schemas, commands, rendering and input behavior are
assembled from extensions. The workspace packages are private and are not yet
published to a registry.

## Run the demo

Use Node 22.12 or later, pnpm 10.14.0 and Rust 1.93.1 or later:

```sh
rustup target add wasm32-unknown-unknown
pnpm install --frozen-lockfile
pnpm run setup
pnpm run demo
```

The Vite React application lives in `apps/demo`. `/editor.html` opens the writing
demo; `pnpm run demo:extensions` opens `/extensions.html` with diagnostics and
extension examples. Sample switching, the outline and incremental book loading
belong to the app, rather than the editor packages.

`pnpm run build` builds packages and produces `apps/demo/dist`.
`pnpm run preview` serves that production build on port 5176. Setup prepares the
WASM and font assets under `apps/demo/public`; another application must serve
these assets too, or supply a `resolveAsset` function to its mounted view.

## Mount an editor

This example uses supported package exports. `starterBrowserExtensions` assembles
the standard content definitions, editing commands, history and browser rendering
and input contributions. Applications can instead assemble their own extensions.

```ts
import { createEditor } from '@gprose/core';
import { createSchema } from '@gprose/model';
import { starterBrowserExtensions } from '@gprose/starter-kit/browser';
import { mountEditor } from '@gprose/view';

const editor = createEditor({
  schema: createSchema({ extensions: starterBrowserExtensions() }),
  content: [{ kind: 'paragraph', text: 'Start writing.' }],
});

const host = document.createElement('div');
host.style.height = '400px';
document.body.append(host);

const view = mountEditor(host, { editor });
await view.ready;
editor.commands.focus();
```

The view owns rendering, native input, geometry and graphics resources. It borrows
the session. `view.destroy()` releases the view while leaving the session usable;
`editor.destroy()` ends the session. Handle a rejected `view.ready` promise or
use the view's error callback. No renderer or engine factory is required.

Commands operate on the current transaction draft:

```ts
editor.can().toggleFormat('bold');
editor.chain().toggleFormat('bold').insertText('Hello').run();
editor.commands.undo();
```

Command names and arguments are inferred from the installed extensions. The
imperative transaction and selection interfaces remain available for custom
commands. See [session commands](docs/editor-session-api.md),
[mounted view lifetime](docs/mounted-editor.md) and
[typography and fonts](docs/view-fonts.md).

For headless use, assemble `starterExtensions` from `@gprose/starter-kit` instead.
The session, schema validation, commands, history and static serialization work
in ordinary Node without a DOM or a TypeScript loader.

## React

Create a stable schema outside rendering. `useEditor` owns the session;
`EditorContent` owns its mounted view. The hook returns `null` before its effect
commits, which the content component accepts.

```tsx
import { createSchema } from '@gprose/model';
import { EditorContent, useEditor, useCommandState } from '@gprose/react';
import { starterBrowserExtensions } from '@gprose/starter-kit/browser';

const schema = createSchema({ extensions: starterBrowserExtensions() });
const editorStyle = { height: 400 };

export function DocumentEditor() {
  const editor = useEditor({
    schema,
    content: [{ kind: 'paragraph', text: 'Start writing.' }],
  });
  const undo = useCommandState(editor, 'undo');

  return (
    <>
      <button disabled={!undo?.available} onClick={() => editor?.commands.undo()}>
        Undo
      </button>
      <EditorContent editor={editor} style={editorStyle} />
    </>
  );
}
```

An application that already owns a session can pass it directly to
`EditorContent`. Selector hooks support toolbars without rerendering the entire
app for every edit. Custom React node, mark, inline and widget views use the same
rendering contracts as native extensions. See
[React integration](docs/react-integration.md),
[rendering extensions](docs/rendering-extensions.md) and
[React extensions](docs/react-extensions.md).

## Schemas, extensions and persistence

`@gprose/model` defines nodes, marks and inline objects. `createSchema` assembles
extensions into a typed schema implementing Standard Schema v1. The schema
validates incoming content and supplies configured defaults. Custom schemas do
not require starter-kit, React or a particular text field name.

Behavior extensions contribute commands, queries and per-session state through
`@gprose/core`. Browser extensions contribute presentations, native views,
decorations, input policies and shortcuts through `@gprose/view`. Standard
paragraphs, headings, lists, quotes, images and formatting belong to extension
packages. Tables and external comment annotations are also extensions.

Use the document codec for persisted content. Durable external ranges need the
corresponding document identity and position checkpoint; they are values an
application can store independently of the document. Ordinary document snapshots,
position checkpoints and undo history serve different purposes. See
[references](docs/editor-references.md), [static serialization](docs/static-serialization.md),
[HTML parsing](docs/html-parsing.md) and [delayed edits](docs/delayed-edits.md).

The renderer supports Latin, Greek, Cyrillic, Arabic and Hebrew, with combining
marks, common symbols, emoji and mixed-direction visual selection. Chinese is
available as a browser reference; complete international typography remains
unimplemented. See [international text](docs/research-international-text.md). The implementation includes text, node and rectangular table selections;
see [selection behavior](docs/editor-selections.md) and
[clipboard behavior](docs/clipboard.md) for their supported operations. A network
collaboration transport and conflict-resolution algorithm are not implemented.

## Validate and explore

```sh
pnpm exec playwright install chromium firefox webkit
pnpm run check
```

The required check builds all packages, runs ordinary Node and built browser
consumers, checks emitted declarations, then runs lint, formatting, types,
ownership checks, Vitest and Playwright E2E tests. Browser coverage runs in
Chromium, Firefox and WebKit. Use `pnpm run test:unit`, `pnpm run test:browser`,
`pnpm run test:e2e` or `pnpm run test:watch` for narrower feedback.

Runnable built consumers live in [tests/consumers](tests/consumers): a complete
starter-kit editor, independent vanilla and React schemas, a standalone table
with custom cell text, and custom inline objects in standard paragraphs/headings.
A plain Node React SSR fixture also verifies imports and static rendering. `pnpm run check:built-consumers` verifies them without
private source imports. `pnpm run format` applies the shared Oxfmt configuration.

See the [repository map](docs/repository-map.md),
[app ownership guide](docs/editor-app-architecture.md),
[implementation plan](docs/public-interface-implementation-plan.md) and
[progress record](docs/public-interface-progress.md) and
[completion audit](docs/public-interface-completion-audit.md) for responsibilities,
verified behavior and deferred work.
