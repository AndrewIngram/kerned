# Editor app ownership

The writing demo and extension study are two routes of one Vite React app. Both
HTML files load `src/demo/app/main.tsx`. The entry loads the initial sample and
mounts `App`; it does not initialize graphics or layout resources. Run
`pnpm run demo` to open the writing route.

`EditorWorkspace` assembles the browser schema and calls `useEditor`. That hook
creates a headless session after commit and destroys it on unmount. The committed
session passes to `EditorWorkspaceView`, which renders the toolbar, content host
and application panels. `EditorContent` mounts the same complete native view as
vanilla consumers and borrows the session. See [React integration](react-integration.md)
and [mounted editor lifetime](mounted-editor.md) for those interfaces.

## What belongs where

| Owner                                     | Responsibility                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/model`, `src/transform`, `src/state` | Schema, immutable content, operations, mapping, selections and transactions                  |
| `src/core`                                | Composed headless session, named commands/queries, extension state and lifetime              |
| `src/editor-browser`                      | Native events, input capture, navigation, document projection, node-view and layer contracts |
| `src/editor-react`                        | Optional session ownership, borrowed content host, context and selector subscriptions        |
| `src/editor-canvas`                       | Complete mounted view, assets, layout, viewport, graphics, paint and frame scheduling        |
| `src/extensions/starter-kit`              | Standard schema/commands, input policy, presentation and native block rendering              |
| `src/demo/app`                            | Sample loading, toolbar, external comment UI, find/outline panels and diagnostics            |

The headless modules import neither React nor browser code. Browser and canvas
modules are independent of React, and generic adapters do not import a particular
schema. Starter-kit code cannot import app code, sample loaders, demo styles or
benchmark fixtures. Project dependency checks enforce these rules.

## How to follow an edit

```text
native event -> contributed input policy -> imperative session command
  -> state transaction and publication
  -> mounted view layout/painting + subscribed application selectors
```

Toolbar actions, native input and programmatic edits use the same command
definitions. Consumers invoke named commands; input policies use the imperative
transaction context. The mounted view discovers presentation, input, node-view
and layer contributions from the session. The demo supplies no engine, shaper,
manual layout callbacks or parallel renderer list.

Tables and images use native node-view contributions. The table extension owns
grid commands and cell input; the mount supplies clipboard dispatch, selection
context, typography and geometry. Native text views read contributed decorations
by node ID. Search and comments supply those sources; the app does not build
highlight maps. Styles belong to their browser extensions, with demo theme
overrides in the app stylesheet.

Comments, mentions, underlines, list markers, quote rules and canvas search use
view-layer contributions. They receive resident block geometry and drawing
operations without native graphics handles. Comment/mention activation uses
session-local subscriptions consumed by application panels. Comment rendering
subscribes to its external store and invalidates independently of React or
transactions. Find sessions own cooperative refresh and stale-result suppression;
the app's find hook owns opening, focus and controls.

## Lifetime and performance

- The session owns content, history, anchors and extension resources. The hook
  owns its session; the context provider and content host borrow it. Strict Mode
  replay releases the previous owned session before creating its replacement.
- Each mounted view owns fonts, shaping, its scene, native surfaces, input,
  viewport, node views and layers. Destruction cancels pending initialization,
  releases those resources and rejects late work. Immutable fetched asset bytes
  use a bounded shared cache, so sample changes do not reload static files.
- Scenes have separate shaping/composition ownership. Destroying or evicting one
  scene does not invalidate another editor with the same numeric node IDs.
- The native layout controller owns measured heights, viewport culling, pinned
  interaction targets, background reflow and scroll anchoring. React subscribes
  to public geometry for the outline, find and annotation panels.
- Font and theme changes update the live view. Font replacement keeps the prior
  collection usable while loading; failed replacement preserves it. Metric
  changes reflow visible content first; paint-only color changes reuse layout.
- Node views own decoding, measurement and cancellation. Culled DOM does not own
  semantic state. General React node/mark/widget rendering and public decoration
  authoring remain milestone 6 work.
- `useSampleStream` owns sample append scheduling and cancels work on unmount. Its
  controller measures new composition work rather than total document size.
- `useDiagnostics` is the only app module importing correctness fixtures. It uses
  the separate diagnostics interface rather than private native resources.

Built workspace exports and external consumer migration remain milestone 8 work.
The [implementation progress](public-interface-progress.md) records completed
checks, architecture reviews and remaining requirements.
