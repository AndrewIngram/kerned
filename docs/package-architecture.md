# Package architecture

Status: proposed target for the approved public-interface refactor. Package names
below are intended module entry points, not existing published packages.

Execution: [detailed public-interface implementation plan](public-interface-implementation-plan.md)
with milestone tasks, acceptance cases, migration gates and completion checklist.

Design evidence: [Tiptap API audit](tiptap-api-audit.md) and its
[adapter and persistence findings](tiptap-adapters-research.md).

The audit adds these requirements to the migration:

- One extension definition contributes schema, commands, queries, rules and view
  behavior through the appropriate contracts; kits only compose definitions.
- Command execution, chaining and availability share an implementation. Preserve
  mixed activity and suppress side effects in dry runs.
- Extension options, transactional fields, ephemeral caches and stored document
  attributes have distinct ownership and persistence rules.
- Session events distinguish content, selection and view lifecycle; React uses
  selectors rather than rerendering the document on every transaction.
- Static codecs are independent of interactive node/mark rendering. Headless
  imports must not initialize browser or graphics resources.
- Decorations support external-state invalidation and incremental updates, with
  stable identities independent of viewport residency.
- Async integrations capture durable targets and cancel obsolete requests.
- Composition validates conflicting capabilities, including undo ownership;
  future collaboration must not install a competing history manager silently.

## Lessons from ProseMirror

ProseMirror separates document representation, editing operations, editor state,
and the browser view:

- [model](https://github.com/ProseMirror/prosemirror-model) owns document nodes,
  marks and the machinery for describing schemas.
- [transform](https://github.com/ProseMirror/prosemirror-transform) owns document
  transformations and position mappings. Its package depends on model.
- [state](https://raw.githubusercontent.com/ProseMirror/prosemirror-state/master/src/index.ts)
  exports editor state, selections, transactions and plugins.
- [view](https://raw.githubusercontent.com/ProseMirror/prosemirror-view/master/src/index.ts)
  owns browser rendering and input, and exports decorations and node/mark views.
- [schema-basic](https://github.com/ProseMirror/prosemirror-schema-basic) and
  [schema-list](https://github.com/ProseMirror/prosemirror-schema-list) supply
  concrete content types; list commands accompany list schema definitions.
- [history](https://github.com/ProseMirror/prosemirror-history) supplies undo
  behavior separately from document representation.

This is an ownership precedent, not a dependency graph to copy literally.
ProseMirror state and view declare dependencies on each other; the state plugin
contract imports view types and supports view hooks. See its
[plugin contract](https://raw.githubusercontent.com/ProseMirror/prosemirror-state/master/src/plugin.ts).
Our headless extension contract should avoid requiring browser types.

## Proposed modules

| Entry point   | Owns                                                                                                                                   | Must not know                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `model`       | Generic tree, node identity, marks, schema contracts, document codecs, snapshot positions and range values                             | Starter-kit content names, editor session, browser, React |
| `transform`   | Steps, application, inversion, change mappings, structural edits                                                                       | Mounted view, command UI, history grouping policy         |
| `state`       | Selection, transactions, state fields, revision publication, session subscriptions, durable-reference resolution over revision history | Layout, DOM, React, a concrete schema                     |
| `view`        | Mounted editing surface, native input and IME, geometry, pointer/navigation, decorations, viewport, rendering resources and cleanup    | Demo samples, toolbar design, comment storage             |
| `core`        | Convenient headless editor session, extension composition, named commands, chains, capability queries and lifecycle                    | React, CanvasKit objects, fixed starter schema            |
| `starter-kit` | Optional composition of paragraphs, headings, marks, lists, quotes and other standard extensions                                       | Demo application state                                    |
| `react`       | View mounting adapter, subscriptions, toolbar hooks, React rendering registrations                                                     | Independent editing semantics or transaction state        |

Individual extensions own their schema rules and editing behavior. A table
extension owns cell selection, table commands and rectangular clipboard rules.
A comments extension owns its discussion data and durable ranges; visual
decorations consume those ranges through the view interface. Neither belongs in
the generic model or state implementation.

Core composition registers headless contributions. View contributions are
registered through the view contract. Extension packages may offer separate
headless and view entry points so a server importing table commands does not
load React, the DOM or CanvasKit. The default browser setup composes both for
consumers; they do not manually reconcile two registries.

## Depth and dependency rules

The model is at the bottom. Transform depends on model. State depends on model
and transform. Core composes state and extension contracts. View consumes the
headless editor contract; React adapts the view. Concrete extensions depend on
these contracts, and starter-kit composes extensions. Generic modules never
import starter-kit or the demo.

The view is a deep module: mounting it owns readiness, input, rendering and
teardown. Its private layout implementation may have several modules and typed
buffers. Those internal seams require no serialization. `createOwnedEngine`,
CanvasKit initialization and shaping storage modes are implementation details.
Asset URLs and font configuration remain consumer settings without exposing
engine construction.

The headless session is another deep module: one command path handles toolbar,
keyboard and programmatic edits through the existing transaction guarantees.
Core does not become a catch-all for every helper, nor a second state store.

Deleting a proposed module should push real responsibilities back into callers.
A barrel that merely renames exports or a factory returning `{kit, owned}` does
not meet that test. Prefer internal modules over separately published packages
when there is no independent consumer contract.

History grouping can become a state extension. Durable-reference mapping
retention must remain independent of the undo stack's lifetime: comments must
not lose their anchors because undo entries were pruned. Collaboration adapters
will consume operations and mappings without owning browser state.

## Current migration state

Milestones 0–3 have separated model, transform, state and core, compiled typed
Standard Schema assemblies and moved editing to composed session commands. See
[verified progress](public-interface-progress.md) for review and validation evidence.

The remaining view/package differences are:

- `src/demo/app/main.tsx` starts a private view-resource lifetime and still passes
  its borrowed resources to the workspace. Public mounting must take over.
- `src/editor-react/editor.tsx` mounts listeners while the demo assembles the
  complete editing surface. Painting, native input and document layout now have
  framework-independent controllers, as does viewport observation and scrolling.
  React subscribes and attaches. Asset loading now owns readiness and cancellation;
  integrating that lifetime and DOM overlays still needs the complete mounted view.
- Scenes have independent cache owners. Sample changes no longer require a
  synchronous unmount to coordinate shared cache cleanup.
- Starter commands compose with foreign node definitions, but browser codecs,
  projection and rendering still need their complete extension-driven migration.
- Built workspace exports and external consumer fixtures remain milestone 8.

## Standard Schema document contract

Requirement: the final assembled document schema implements `StandardSchemaV1`
directly. Consumers can infer its input/output document types and pass it to
tools accepting Standard Schema without a Gprose-specific adapter. The standard
defines an unknown-input validator returning a typed value or issues with paths;
it permits synchronous or asynchronous results.
[Standard Schema specification](https://standardschema.dev/).

Composition must preserve extension-specific node and mark discriminants and
attribute types. Merely attaching the standard property to today's manually
declared `StarterNode` union would not deliver this requirement. Inference comes
from the extension definitions; runtime validation derives from the same rules.
Runtime-loaded extension lists necessarily have less precise static types than
statically known definitions. Structural constraints and cross-node invariants
remain runtime checks even where TypeScript cannot express them fully.

The document schema validates structured document content, not HTML strings,
renderer objects, session history or collaboration checkpoints. Codecs translate
external formats into that content separately. Input/output differences must be
explicit when defaults or normalization transform accepted content; validation
must not silently delete unsupported nodes or marks.

Provide synchronous document validation for editor operation. Async application
checks such as remote permission lookup are separate; do not turn each local
transaction into asynchronous schema validation. Validate imported documents at
entry, then preserve schema invariants through checked operations over affected
content, rather than parsing the whole book on every keystroke.

Extension attribute validators may consume Standard Schema as well, provided the
editor's synchronous and serializable-output requirements are enforced. Do not
require a particular validation library. Opaque validators do not expose enough
structure to infer schema relationships or generate JSON Schema; retain explicit
node/content metadata. Standard JSON Schema export is a separate capability,
not something implied by Standard Schema conformance.

Acceptance: inferred custom attributes and node unions, nested validation issue
paths, unknown-extension rejection, explicit defaults, synchronous results,
consumer integration through the standard contract, and unchanged incremental
edit performance. No conformance implementation exists yet.

## Configurable typography and presentation

Typography is view configuration with extension-supplied defaults. A heading's
level is document semantics; its font size, weight, leading and surrounding
space are presentation. Changing the theme does not produce a document
transaction, alter durable positions or create an undo entry.

Current hardcoded policy is spread across several owners:

- `src/extensions/typography.ts` fixes four heading styles, scales everything
  against an 18px body, and rounds spacing and leading to a 4px grid.
- `src/editor-scene.ts` independently fixes the baseline grid to 4px, forces
  headings bold and assigns non-text blocks a 24px trailing gap.
- `src/extensions/table-view.tsx` resolves heading typography against 18px while
  body typography also depends on table CSS in `src/editor.css`.
- `src/engines.ts` and the shaping implementation fix the available font faces.

The view must resolve defaults, extension presentation rules and consumer
overrides into one immutable style snapshot. Custom nodes and marks contribute
their own presentation rules; a central enum of paragraph and heading styles
must not limit the extension contract. Context such as a table cell or list
item can affect resolved styles without changing document content.

Consumer settings cover font families and faces, sizes, weights, line heights,
block spacing, indentation and optional baseline-grid alignment. Starter-kit
provides the current typography as defaults, including the current spacing
policy. Default heading boldness must remain overridable. Arbitrary font weights
or families require registered matching faces or an explicit fallback policy;
changing a CSS string cannot configure canvas shaping.

The layout implementation consumes resolved numeric metrics and font identities,
not node names or theme callbacks. Canvas painting, hit testing, selection
geometry and DOM renderers consume the same resolved style information. The DOM
adapter applies resolved values explicitly instead of expecting application CSS
to configure canvas text. Toolbar styling remains application-owned.

Resolve and validate configuration when it changes, then cache derived styles.
Do not repeatedly merge theme objects or invoke consumer callbacks for every
glyph or frame. Metric changes invalidate affected shaping/layout caches and
start viewport-prioritized reflow with scroll anchoring. Paint-only changes
request repaint without reshaping. Font readiness participates in the same
invalidation and lifetime rules. Initial estimates and offscreen geometry must
use the same settings as final layout.

Proof cases include two editors with different themes, custom heading metrics,
no baseline grid, table/outer-text consistency, a custom node's presentation,
font replacement, and live metric changes in a large document without stale
caret geometry, lost selection or document edits.

## Migration and proof

1. Establish model, transform and state ownership with narrow entry points and
   import checks. Migrate callers while extracting responsibilities; avoid moving
   the same coupling into new folders.
2. Compose extensions and named commands in the headless editor session. Preserve
   transaction atomicity, permissions, selection mapping and dry-run behavior.
3. Move view assembly and lifecycle out of the demo and React hooks. Keep the
   single supported canvas architecture private to the view implementation.
4. Adapt that view to React and migrate the demo to consumer entry points. Remove
   superseded assembly helpers as callers migrate.
5. Enforce package exports and prevent imports into another module's internals.
   Validate the built consumer entry points, not just TypeScript source aliases.

Proof cases: a headless custom schema without browser globals; the starter kit;
an omitted default extension; a custom node with view behavior; commands without
React; two mounted editors with overlapping numeric node IDs; unmount during
asset loading; document replacement; and repeated mount/destroy without retained
native resources. Existing selection, clipboard, permissions, anchor and
large-document performance checks remain migration constraints.

Package separation introduces no worker, JSON or WASM boundary. Optimizations
inside the layout implementation remain possible without changing consumer code.
