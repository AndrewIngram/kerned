# gprose

A canvas text editor with React extensions. The writing demo is at
[`/editor.html`](editor.html); the site root redirects there.

## Run locally

Use Node 22.12 or later, npm, and Rust 1.93.1 or later.

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run setup
npm run demo
```

Setup downloads and verifies the Noto Sans and emoji fonts, copies CanvasKit's
WebAssembly module, and builds the HarfRust shaping bridge. `npm run dev` starts
the same Vite server without opening a browser.

The editor supports headings, lists, quotes, tables, formatting, comments,
find, an outline, rich paste, and undo/redo. The sample picker loads Draft,
Warbreaker, or War and Peace. Changes stay in memory and reset on reload or
sample switching. See [sample sources and conversion](docs/html-samples.md).

The text engine supports Latin text and emoji. It does not provide general
script fallback, bidirectional layout, or a complete accessible reading and
editing representation for canvas text.

## Extension diagnostics

`npm run demo:extensions` opens [`/hybrid-editor.html`](hybrid-editor.html).
This uses the same editor implementation and adds fixtures for atomic mentions,
React checklists, image blocks, zoom, and streaming diagnostics. Keep this page
and its checks when changing extensions, including features absent from the
writing demo.

## Build and verify

```sh
npm run build
npm run preview
```

The build prepares assets, checks project references and the editor dependency
boundary, type-checks TypeScript, and writes both editor pages to `dist/`.
Preview serves them on port 5176.

```sh
npx playwright install chromium firefox webkit
npm test
```

The default tests start the dev server and exercise the writing demo and the
extension contracts in all three browsers. With `npm run dev` running, use the
focused checks for broader interaction coverage:

```sh
npm run check:editor-demo
npm run check:editor-blocks
npm run check:editor-tables
npm run check:editor-page-scroll
npm run check:editor-unicode
```

With the production preview running, validate extension interactions and
transaction history:

```sh
npm run check:hybrid
npm run check:transactions
```

Other `check:editor-*`, `check:hybrid-*`, and benchmark scripts cover clipboard,
search, book loading, viewport reflow, and memory. Reports and screenshots go to
`artifacts/`. `npm run check:project` detects missing scripts, broken documentation
links, and source files unreachable from the editor or extension entry points.

## Code map

- `src/editor/`: schema-independent transactions, selections, anchors, and search.
- `src/extensions/`: document schema, formatting, blocks, tables, clipboard,
  outline, mentions, comments, and React views.
- `src/editor-react/`: registration of canvas paint callbacks from React.
- `src/hybrid-spike.tsx`: shared host for the writing and diagnostics pages.
- `src/hybrid-scene.ts`: block placement, viewport reflow, and geometry retention.
- `src/owned-*.ts` and `native-owned/`: the active layout engine and shaping bridge.
  The `owned` name refers to layout we control; these are required by the editor.
- `src/engines.ts` and `src/model.ts`: shared layout contracts and text types.

Start with the [extension boundary](docs/editor-extension-boundary.md),
[React integration](docs/react-extensions.md), [layout pipeline](docs/layout.md),
and [transaction and anchor contracts](docs/editor-transactions-and-anchors.md).

The earlier CanvasKit/Parley comparison, Glyph experiment, and standalone
owned-layout comparison are available in Git history. Their pages, native
Parley bridge, scripts, and reports are no longer part of the working project.
