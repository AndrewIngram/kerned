# Editor app ownership

The writing demo and extension study are two routes of one Vite React app. Both
HTML files load `src/demo/app/main.tsx`. The entry starts a private view-resource lifetime and loads the
initial sample, then mounts `App`. Run `pnpm run demo` to open the writing route.
The [public-interface plan](public-interface-implementation-plan.md) defines the
remaining complete-view and package migration; this page describes current code.
The [mounted editor interface](mounted-editor.md) now provides a complete native
lifetime for contributed custom schemas and the public React `Editor`. The demo
still uses an internal event host while its starter contributions are migrated.

## What belongs where

| Owner                                     | Responsibility                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/model`, `src/transform`, `src/state` | Schema, immutable content, document operations, mapping, selections and transaction publication                        |
| `src/core`                                | Composed headless session, named commands/queries, typed adapter contributions, extension lifetime and view attachment |
| `src/editor-browser`                      | Native events, input capture, pointer/multiclick policy, keyboard navigation and generic document projection           |
| `src/editor-react`                        | Optional subscriptions and attachment adapters for input, painting and viewport observation                            |
| `src/editor-canvas`                       | Framework-independent asset lifetime, scene layout, reflow, surfaces, painters and frame scheduling                    |
| `src/extensions/starter-kit`              | Standard schema/commands, container presentation, toolbar labels and native block rendering                            |
| `src/demo/app`                            | Samples, toolbar presentation, external comment UI, search, outline and diagnostics                                    |

The headless modules import neither React nor browser code. Browser and canvas
modules are independent of React, and generic adapters do not import a particular
schema. Starter-kit code cannot import app code, sample loaders, demo styles or
benchmark fixtures. Project dependency checks enforce these rules.

## How to follow an edit

```text
native event -> browser/input adapter -> named session command
  -> state transaction and publication -> shared document query + starter labels
  -> generic document layout controller -> canvas controller and native block layer
```

Toolbar, native input and programmatic calls share command definitions. Native
input applies those definitions through the imperative transaction context;
consumers use the named command API. The browser starter tuple contributes
its input policy and paragraph/heading presentations to the public mount.
`EditorWorkspace` still assembles the rendering, input and layout adapters; the
new mounted-view interface must take over that assembly in the demo. The browser starter
kit adds image rendering through the same extension tuple as schema and commands.
`createNodeViews` reads those session contributions, binds renderers to schema
definition families and owns per-node cleanup when the session is destroyed.
Tables and images use those same contributions in both the demo block layer and
the public mount. The table extension owns grid commands and native cell input;
the mount supplies its clipboard dispatcher and cached selection context. Find
state becomes transient highlight ranges before crossing into native views.
The table's base styles belong to the browser extension; demo-specific theme
overrides remain in the app stylesheet. Ownership checks allow styles inside
their module and reject imports from the demo or another module.

The block layer still composes text-decoration controllers. React only attaches
this layer; the superseded per-node React wrappers and parallel registry have
been deleted. Inline/decorations still need extension contribution contracts
before the public mount is complete. Comment threads remain external to document state.

Custom rendering can use `createTextInteraction().bind(...)` with its own text
and line geometry. `createCanvasInput` owns pointer/navigation binding, hidden-textarea synchronization
and caret reveal. `useCanvasInput` only attaches it and supplies committed layout
frames. Neither depends on paragraph or heading names.

## Lifetime and performance constraints

- `App` replaces a keyed workspace when a sample finishes loading. Each scene has
  an independent layout owner, so ordinary React replacement is sufficient;
  no forced synchronous unmount coordinates a global cache. Fonts and imported
  source data remain resident across sample changes.
- The canvas controller owns native surfaces, paint, registrations and queued
  frames. Its React adapter attaches/detaches it. Terminal destruction prevents
  revival; stale cleanup cannot remove a replacement attachment or registration.
- Each scene retains only its own paragraph shaping/composition. Eviction or
  clearing one scene cannot invalidate another scene with identical node IDs.
  Mention labels use uncached snapshots rather than a reserved document ID.
- View-resource initialization resolves asset URLs, owns fetch cancellation and
  publishes readiness only after fonts and shaping initialize. Destruction rejects
  pending readiness and prevents late work from publishing native handles. A
  temporary preloaded graphics URL is revoked after CanvasKit initialization.
- Graphics/layout resource destruction releases fonts, faces, paint, block
  sessions and the WASM runtime. Pure geometry snapshots remain readable; native
  drawing through a destroyed resource owner is rejected.
- The document layout controller owns background reflow, measured widget heights,
  viewport culling and caret geometry. It coalesces document notifications in a
  microtask and schedules background work after paint submission. React subscribes
  to snapshots and acknowledges
  their DOM placement before scroll anchoring. Pending anchor adjustments survive
  multiple publications; live user scrolls take precedence. Document projection
  shares one indexed snapshot across toolbar queries. `editor-browser/document.ts`
  walks schema-defined children, maps selections to rendered blocks and resolves
  a nested position's rendered owner. The starter `browser-document.ts` adds
  container indentation and toolbar labels. List markers and quote rules now
  belong to the starter container-decoration contribution, shared by the demo and
  public mount through `editor-browser/view-layers.ts`. That owner translates the
  existing projection into culled layer frames and owns layer cleanup. The generic layout controller
  takes pinned positions and top padding rather than search/comment panel state.
  Its React attachment lives in `editor-react/use-document-layout.ts`.
- The viewport controller owns native measurement, zoom and scrolling. A scroll
  command publishes the actual clamped position immediately; callers do not
  synchronize a separate React scroll state. Repeated native events preserve
  snapshot identity when the viewport is unchanged.
- Image views own decoding, measurement and cancellation outside React. Their
  adapter attaches and supplies frames; demo loading delays are explicit app input.
  Each mounted editor retains a bounded image-dimension cache. Source changes reset
  loading state, and obsolete decoding cannot update a successor or its measurements.
- Mention labels use a bounded view-owned snapshot cache, independent of document
  node IDs. Viewport eviction no longer reshapes a label when its view remounts.
  Cached snapshots borrow the layout resource owner's fonts and survive cache eviction.
- The input adapter positions the hidden textarea beside the visible caret.
  Placing it at the document origin can make native typing jump to the top.
- `useSampleStream` owns append scheduling and cancels work on unmount. Its batch
  controller uses new composition time rather than total document bookkeeping.
- `useDiagnostics` is the only app module importing correctness fixtures. Canvas
  diagnostics expose a readonly painter count rather than a mutable registry.

Complete DOM-overlay ownership and demo migration remain milestone 4 work.
The public vanilla mount now covers native tables and container decorations.
Asset loading now
has a private owner with readiness, failure and destruction; the entry no longer
constructs CanvasKit or chooses engine storage. The demo still passes borrowed
internal resources through its tree, which the complete mounted view must remove.
