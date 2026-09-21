# Editor app ownership

The writing demo and extension study are two routes of one Vite React app. Both
HTML files load `src/demo/app/main.tsx`. The entry loads engine assets and the
initial sample, then mounts `App`. Run `pnpm run demo` to open the writing route.
The [public-interface plan](public-interface-implementation-plan.md) defines the
remaining complete-view and package migration; this page describes current code.

## What belongs where

| Owner                                     | Responsibility                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/model`, `src/transform`, `src/state` | Schema, immutable content, document operations, mapping, selections and transaction publication        |
| `src/core`                                | Composed headless session, named commands/queries, extension lifetime and view attachment              |
| `src/editor-browser`                      | Native events, input capture, pointer/multiclick policy and keyboard navigation                        |
| `src/editor-react`                        | Optional subscriptions and attachment adapters for input, painting and viewport observation            |
| `src/editor-canvas`                       | Framework-independent surfaces, painters, selection/highlight/caret drawing and frame scheduling       |
| `src/extensions/starter-kit`              | Standard schema/command composition, document projection, incremental layout and React block rendering |
| `src/demo/app`                            | Samples, toolbar presentation, external comment UI, search, outline and diagnostics                    |

The headless modules import neither React nor browser code. Browser and canvas
modules are independent of React, and generic adapters do not import a particular
schema. Starter-kit code cannot import app code, sample loaders, demo styles or
benchmark fixtures. Project dependency checks enforce these rules.

## How to follow an edit

```text
native event -> browser/input adapter -> named session command
  -> state transaction and publication -> createStarterDocumentQuery
  -> document layout controller -> canvas controller and React BlockLayer
```

Toolbar, native input and programmatic calls share named session commands.
`EditorWorkspace` still assembles the rendering, input and layout adapters; the
complete mounted-view interface must take over that assembly. Comment threads
remain external to document state.

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
- Graphics/layout resource destruction releases fonts, faces, paint, block
  sessions and the WASM runtime. Pure geometry snapshots remain readable; native
  drawing through a destroyed resource owner is rejected.
- The document layout controller owns background reflow, measured widget heights,
  viewport culling and caret geometry. It coalesces document notifications in a
  microtask and schedules background work after paint submission. React subscribes
  to snapshots and acknowledges
  their DOM placement before scroll anchoring. Pending anchor adjustments survive
  multiple publications; live user scrolls take precedence. Document projection
  shares one indexed snapshot across toolbar queries.
- The viewport controller owns native measurement, zoom and scrolling. A scroll
  command publishes the actual clamped position immediately; callers do not
  synchronize a separate React scroll state. Repeated native events preserve
  snapshot identity when the viewport is unchanged.
- The input adapter positions the hidden textarea beside the visible caret.
  Placing it at the document origin can make native typing jump to the top.
- `useSampleStream` owns append scheduling and cancels work on unmount. Its batch
  controller uses new composition time rather than total document bookkeeping.
- `useDiagnostics` is the only app module importing correctness fixtures. Canvas
  diagnostics expose a readonly painter count rather than a mutable registry.

Complete asset readiness/cancellation, DOM-overlay ownership and public vanilla
mounting remain milestone 4 work. The demo still initializes and passes internal
engine resources; that is not the intended final consumer interface.
