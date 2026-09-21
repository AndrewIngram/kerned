# Public interface implementation plan

Date: 2026-09-21. Status: implementation in progress. Milestones 0–1 are complete;
milestone 2 is in progress. See [verified progress](public-interface-progress.md)
for shipped interfaces and remaining requirements. This plan describes the full
target, including interfaces that are not yet implemented.

This is the execution plan for the approved scope: package discipline, complete
view lifetime, extension and command composition, configurable typography,
optional React integration, and a Standard Schema-compatible assembled schema.
It supersedes earlier public-interface sketches where they conflict. The
[foundation plan](editor-implementation-plan.md) still owns the separate
collaboration/authority work; this refactor must preserve its implemented behavior.

Design inputs:

- [Target repository map and quality-tool migration rules](repository-map.md)

- [Package ownership and dependency rules](package-architecture.md)
- [Tiptap interface audit](tiptap-api-audit.md)
- [React, rendering and persistence research](tiptap-adapters-research.md)
- [Current foundation progress](editor-foundation-progress.md)
- [Current app ownership](editor-app-architecture.md)

## Success from a consumer's perspective

1. A consumer assembles extensions once into a typed schema, validates unknown
   document content through Standard Schema, and creates an editor session.
2. A vanilla browser consumer mounts that session without constructing a
   renderer, shaper, font cache, scene, input controller or hidden textarea.
3. A React consumer uses the same session and view through hooks and a host.
4. Toolbars, keyboard actions and programmatic edits share named commands,
   availability queries, mixed-state queries and atomic history.
5. A custom node or mark can supply semantics, commands, codecs and rendering
   through supported contracts. Comments and tables have no privileged core path.
6. Each editor can use its own typography. Theme changes preserve content,
   selection, scroll anchoring and durable references.
7. Large document loading, culling, paste and editing retain their performance.

## Interface decisions to carry into implementation

These are semantic commitments; exact builder names may change during type tests.

| Concern              | Contract                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema creation      | `createSchema({ extensions })` produces the reusable assembled schema, including `~standard` validation and inferred content types.                                         |
| Session creation     | `createEditor({ schema, content, ... })` consumes that assembly; callers do not supply a second extension list.                                                             |
| Headless composition | Schema/node/mark rules live in model contracts. The composed headless definition also carries commands and state contributions without a model-to-core import cycle.        |
| Mounting             | `mountEditor({ editor, element, theme, ... })` returns a view with readiness, configuration and destruction.                                                                |
| React                | `useEditor`, `EditorContent`, and selector subscriptions adapt the same session/view. Externally supplied sessions stay externally owned.                                   |
| Edits                | `commands`, `chain`, `can`, queries and an imperative transaction interface share the same implementation.                                                                  |
| Views                | Standard browser contributions are composed by the supplied browser kit; custom overrides use typed renderer registrations. Consumers do not reconcile parallel registries. |
| Content              | Structured document content is distinct from format strings, view objects, undo state and collaboration checkpoints.                                                        |
| Positions            | Snapshot positions and durable reference values have distinct types and resolution contracts. No external-range registration.                                               |

Do not expose engine storage modes or CanvasKit in ordinary setup. Advanced
canvas painting can expose a deliberately scoped painter contract through the
view module; that must not leak into headless session types.

## Target ownership and migration map

Use the pnpm workspace declared at the root, with `packages/*` and `apps/*`.
Start with enforced module entry points inside this repository. Add workspace
package manifests and build exports once the imports obey the intended graph;
do not publish packages as part of this work. Use coordinated versions initially.

| Target module              | Current sources to assess and migrate                                                                               | Ownership                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `model`                    | `src/editor/schema.ts`, `tree.ts`, `marks.ts`, `inline*.ts`, `schema-codec.ts`, document position/range value types | Schema mechanics, identity, structural data, validated content and codecs |
| `transform`                | Step application/inversion portions of `transactions.ts`, `positions.ts`, `replace-ranges.ts`, mapping helpers      | Pure edits and change maps                                                |
| `state`                    | Session publication portions of `transactions.ts`, selections, extension state, history, reference resolution       | Atomic publication, selection and revision-dependent behavior             |
| `core`                     | Command composition and public session construction currently spread across core and starter actions                | Convenient headless composition and named commands                        |
| `view`                     | `editor-browser`, `editor-canvas`, `editor-scene.ts`, `owned-*`, rendering and viewport logic in hooks              | Browser input, geometry, private layout and graphics lifetime             |
| Concrete extensions / kits | `src/extensions`, including `demo-schema.ts`, `demo-model.ts` and `starter-kit`                                     | Content types and their policies, bundled defaults                        |
| `react`                    | `src/editor-react` and remaining framework-specific hosts                                                           | Mounting, subscriptions and React renderers                               |
| Demo                       | `src/demo/app`, sample loading and diagnostics                                                                      | Toolbar appearance, sample navigation, notices and diagnostics            |

Extract responsibilities before moving files. A file can contain several
responsibilities today; its current name does not decide its final owner.
Keep dependencies acyclic: model below transform below state; core composes
headless contracts; view consumes the session; React adapts view. Extension
implementations depend on public contracts, never the other way around.

## Milestone 0: executable consumer contracts and baseline

Tasks:

- Inventory current entry points, demo assembly, private imports, mutable resource
  owners, diagnostic consumers and schema-specific branches in generic modules.
- Add small consumer fixtures for a headless custom schema, vanilla mounting,
  React mounting, and one custom node with a mark and external decoration.
- Write the target usage first. Fixtures may be introduced alongside each
  implementation slice so the main test suite never depends on nonexistent APIs.
- Capture a production-build performance baseline before changing runtime code.
  Reuse existing foundation, loading, paste, reflow and retained-memory scripts.
- Record each pre-existing skip/failure explicitly. The previously skipped
  collaboration convergence case is not fixed by this refactor.

Exit: source ownership inventory and reproducible baseline artifacts exist;
consumer scenarios have concrete expected behavior. Existing tests and build are
green or baseline failures are identified. Do not invent new performance budgets
from an isolated timing sample.

## Milestone 1: model, transform and state seams

Tasks:

- Separate operation application/inversion from session publication and history
  inside `transactions.ts`, preserving operation and mapping semantics.
- Place snapshot value types below revision-dependent resolution. Keep durable
  reference retention independent of undo-history pruning.
- Establish narrow entry points and migrate imports to their owners. Avoid
  broad re-export cycles through the existing `editor/index.ts` barrel.
- Move geometry-specific helpers into the view implementation where appropriate;
  preserve headless selection semantics in state.
- Extend the existing syntax-based import checker to enforce direction, including
  type imports, re-exports and dynamic imports. Prohibit browser/React/graphics
  dependencies in headless modules and concrete schema imports in generic ones.

Verification: existing transaction, permission, selection, split/join/move,
undo/redo and durable-reference tests. A Node-process fixture imports the
headless entry points without DOM globals or asset fetches.

Exit: the seams correspond to distinct responsibilities, not forwarding
barrels. No second transaction implementation or permanent legacy aliases.

## Milestone 2: typed extension assembly and Standard Schema

Tasks:

- Define reusable node, mark and behavior extension definitions with stable
  names, configuration, dependencies and per-session state factories.
- Preserve literal extension names and attribute input/output types through
  statically known extension tuples. Do not manually maintain a universal node
  union alongside those definitions.
- Separate declarative schema metadata from executable command/view contributions
  while keeping a single consumer assembly. Model does not import core or view.
- Implement synchronous `StandardSchemaV1` validation on the final schema.
  Return typed content or structured issues with full nested paths.
- Validate node kinds, attributes, mark ranges, child constraints, identities,
  inline objects and configured restrictions. Define unknown-field handling;
  reject unsupported node/mark types rather than silently dropping content.
- Specify defaults/normalization, input versus output types, traversal limits,
  serialization constraints and immutable ownership of validated data.
- Support Standard Schema attribute validators where synchronous output can be
  guaranteed. The standard itself permits promises; async validators must not
  silently enter synchronous editing. Detect/reject unsupported results clearly.
- Keep HTML/Markdown decoding outside this validator. JSON Schema generation is
  not implied and is deferred until needed.
- Migrate default schema definitions and codecs to the new assembly. Keep runtime
  numeric handles distinct from durable identities; preserve existing saved
  content or supply a versioned migration if representation changes.

Verification:

- Compile-time positive and negative fixtures for inferred node/mark unions,
  custom attributes, defaults and excluded extensions. Negative cases use
  expected compiler errors, not casts.
- Runtime nested error paths, duplicate identities, forbidden children/marks,
  invalid numeric values, malformed inputs and unknown extension versions.
- A consumer accepts the assembled object using the official Standard Schema
  type contract. Test sync behavior separately from structural compatibility.
- Prove runtime-loaded extension lists have honest, less-specific types.
- Instrument ordinary typing to confirm no full-document validation per edit.

Exit: custom content inference derives from installed definitions; standard
conformance is functional, not just a property attached to `StarterNode`.

## Milestone 3: session commands, queries and extension state

Tasks:

- Create the object-configured public session from the compiled assembly.
- Register typed named commands and expose matching direct, chain and dry-run
  forms. Diagnose collisions and missing dependencies during assembly.
- Migrate formatting, headings, lists, blockquotes, tables, selection, clipboard
  and history actions from `starter-kit/actions.ts` to extension contributions.
- Commands read current draft state at execution time. Nested commands share the
  draft; no React snapshot or demo callback is needed to invoke an edit.
- Keep availability separate from active/inactive/mixed activity and selected
  attribute values. Define none/uniform/mixed values explicitly.
- Keep focus/reveal as deferred view effects. Define behavior without a view and
  for a destroyed view. Initially support one mounted view per session explicitly
  rather than choosing an arbitrary recipient for focus.
- Add typed content, selection, transaction and lifecycle events with cleanup and
  documented publication order. Separate persistence notifications from view
  invalidation; subscribers must not recursively corrupt publication.
- Make options, transactional fields, caches and persisted content distinct.
  History ownership is a capability; reject conflicting providers.

Verification: multi-command atomic undo; false command rollback; permissions;
pure dry runs including focus; nested command draft mapping; stale UI callbacks;
two sessions sharing extension definitions without sharing mutable storage;
mixed formatting and queries without React; event order and unsubscribe.

Exit: demo toolbar and input policies use the same session commands. Delete the
superseded action assembly and snapshot-dependent command helpers.

## Milestone 4: complete framework-independent view lifetime

Tasks:

- Introduce the mounted view owning native events, hidden input, IME, pointer
  selection, layout scheduling, viewport, painting and DOM overlays.
- Extract controllers from React hooks; hooks later mount/subscribe to those
  controllers rather than implementing a second behavior path.
- Hide `createOwnedEngine` and engine choices. Add configurable asset resolution
  and internal graphics/shaping initialization with explicit readiness/failure.
- Make async destruction safe before, during and after initialization. Release
  fonts, paints, surfaces, scenes, event listeners, observers and scheduled work.
- Isolate mutable layout caches by owner. Two editors with identical local node
  IDs must never release each other's cached paragraphs.
- Compose extension browser contributions without requiring consumers to match
  parallel schema/input/renderer lists. Keep headless imports free of view code.
- Provide supported geometry/reveal queries for toolbars, decorations and custom
  views; keep diagnostic statistics in a separate diagnostic contract.

Verification: real vanilla editing, cross-node selection, IME, modifier navigation,
page scrolling, full-area pointer placement, native interactive controls, repeated
mount/destroy, failure/retry, destruction during loading, two editors and document
replacement. Confirm late asynchronous work cannot paint into a destroyed view.

Exit: a working editor mounts through the public view interface. The demo no
longer passes kit/owned through its tree or coordinates cache cleanup with
`flushSync`. Existing browser behavior remains intact.

## Milestone 5: configurable presentation and font resolution

Tasks:

- Move existing type rhythm into optional starter-kit defaults. Add validated
  per-view themes and extension-specific rules with deterministic precedence.
- Configure font faces, size, weight, leading, spacing, indentation and optional
  grid alignment. Preserve author-applied formatting as document attributes,
  separate from theme settings and zoom.
- Replace fixed font-index assumptions in shaping/painting with resolved font
  identities, matching face selection and explicit fallback behavior.
- Remove independent constants from `typography.ts`, scene heading styling,
  table text/editing CSS and list markers. Custom extensions participate through
  their presentation contracts, not a central enum of starter node names.
- Compile style snapshots outside per-glyph/per-frame loops. Include style/font
  versions in the relevant cache keys and invalidation rules.
- Metric changes schedule viewport-first reflow; paint-only changes repaint.
  Estimated and final geometry use the same settings. Preserve scroll anchors.

Verification: defaults preserve current visual rhythm; two simultaneous themes;
heading weights/sizes overridden; grid disabled; table text and textarea match;
custom-node rules; font readiness/replacement; color-only update performs no new
shaping; live metric changes preserve caret geometry and selection in Warbreaker.

Exit: no rigid starter-kit typography rules remain inside generic layout.

## Milestone 6: rendering, decorations and React integration

Tasks:

- Define lifecycle and geometry contracts for canvas renderers and DOM overlays,
  with explicit content slots, selection/editability, updates and destruction.
- Add React node/mark/widget registrations and preserve host context. A wrapped
  mark can have several visible fragments; do not assume one DOM rectangle.
- Implement public decoration contributions with stable keys, explicit external
  invalidation and change-range updates where dependencies are local.
- Migrate comments, search highlights, mentions and custom widgets onto those
  contracts. Virtualization must not discard their persistent semantic state.
- Implement `useEditor`, `EditorContent`, provider/context access and selector
  subscriptions, with clear owned-versus-borrowed session lifetime.
- Handle Strict Mode, callback updates, hydration and mount readiness. Server
  imports must not initialize a view; static output is a separate capability.

Verification: same commands/behavior in vanilla and React; no unrelated block
rerenders on toolbar changes; context in overlays; unmount/remount cleanup;
wrapped marks; comment ranges through edits; widget state across culling;
interactive buttons do not move the caret accidentally.

Exit: React is optional, and custom rendering uses the same view implementation
as default rendering. Generic core has no comment/mention special cases.

## Milestone 7: codecs, input policies and delayed edits

Tasks:

- Expose optional static JSON/HTML/text codecs using extension contributions,
  independent of interactive renderers. Specify round-trip and unsupported-content
  behavior. Markdown remains optional and need not be implemented in this wave.
- Keep ordinary snapshots, reference checkpoints and future collaboration state
  visibly distinct in types and documentation.
- Register shortcuts and input/paste rules with deterministic precedence and
  handled/unhandled semantics. Preserve rich rectangle paste and IME behavior.
- Provide the minimal async integration contract: capture durable target, cancel
  obsolete work, resolve target, recheck permissions and open a fresh transaction.
  Full suggestion UI and upload implementations are follow-up extensions.

Verification: rich table/mark/inline round trips; invalid content failure; static
serialization without a DOM; keyboard fallback order; input-rule undo; no double
paste handling; delayed insertion after move/split/delete and permission changes.

Exit: integrations no longer need demo internals, raw node mutation or stale
numeric offsets to perform these operations.

## Milestone 8: consumer migration and package delivery

Tasks:

- Turn the Vite demo into a consumer of supported entry points. Keep toolbar
  appearance, samples and diagnostics in the application. Preserve both demo
  routes, sample switching, outline and incremental loading.
- Add package manifests, explicit exports, declarations and reproducible builds
  for justified modules; keep the renderer implementation private. Cross-module
  private imports fail checks. Avoid duplicate runtime class identities.
- Validate package exports with a fixture outside `src` using built artifacts,
  including headless Node, vanilla browser and React consumers.
- Remove replaced exports, obsolete adapters and unreachable code in the same
  migration wave. Update scripts and diagnostic consumers deliberately.
- Replace README prototype assembly instructions with runnable consumer examples.
  Document readiness/errors, configuration, custom extensions, persistence and
  ownership. State actual supported behavior and limitations.

Exit: consumers can build without private source imports, and the demo proves
the same public interface. No publishing/deployment is required.

## Sequencing and verification gates

Preserve the current Oxlint/oxfmt setup, vendored anti-slop plugin, strict
typechecking, React compiler configuration, Vitest unit/browser split and isolated
Playwright E2E server. These are migration constraints, not cleanup to redo.
Every source move updates discovery/configuration in the same slice, with
before/after test-collection comparison. The repository map specifies the checks.

Order: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Introduce small vertical slices within
each milestone; preserve a working demo throughout. Consumer migration starts
as soon as each contract works, with packaging/documentation finalized in 8.
Do not keep two production editing architectures as a migration strategy.

For each slice: focused behavioral/type tests, typecheck, dependency checks and
diff review. For a completed runtime milestone: production build and browser
regressions across Chromium, Firefox and WebKit. Finish source edits before
running browser tests to avoid Vite hot-reload invalidating test imports.

Performance gates use production builds, the same documents/browser versions,
and repeated runs. Compare first usable paint, stream completion, typing and
navigation latency, paste handler/paint time, reflow, retained memory, and counts
of shaping/full-document traversal. Keep existing budget scripts authoritative;
record regressions and their cause rather than increasing thresholds silently.

## Risks and decisions to resolve in implementation

| Risk                                               | Required treatment before completing the affected milestone                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type inference becomes unusably complex            | Measure compiler behavior with nested custom schemas; keep runtime constraints honest instead of encoding every relationship in conditional types. |
| Standard Schema accepts async validators           | Establish synchronous extension validation contract and explicit rejection; never block local edits on arbitrary promises.                         |
| New content representation breaks saved references | Preserve stable keys and operation semantics; version and test migrations before switching the demo.                                               |
| Headless assembly accidentally imports view code   | Verify emitted imports and server execution, not just type-only intent.                                                                            |
| Extension ordering changes behavior                | Deterministic ordering, duplicate/conflict errors, shortcut and normalization fixtures.                                                            |
| Undo and reference persistence become coupled      | Prune undo independently and prove externally stored ranges survive checkpoint/reload.                                                             |
| Resource sharing causes cross-editor corruption    | Explicit mutable ownership, overlapping-ID fixtures and real lifecycle retention checks.                                                           |
| Theming invalidates too much work                  | Separate metric and paint invalidation; instrument shaping and cache reuse.                                                                        |

Implementation defaults: preserve current UX, use one active view per session
initially, retain the current renderer, and expose documented advanced contracts
only where existing extensions need them. Multi-view focus routing, a new
collaboration algorithm, schema hot-swapping, JSON Schema generation, additional
international text support and a complete Tiptap-compatible catalog are separate
work. None is implied by a new interface name.

## Completion checklist

- [ ] All eight implementation milestones plus baseline are complete.
- [ ] Built consumer examples work without internal imports or engine factories.
- [ ] Assembled schema passes inference, validation and Standard Schema tests.
- [ ] Custom schemas and extensions work without starter-kit or React.
- [ ] Commands, permissions, selections, references and clipboard retain behavior.
- [ ] Configurable typography reaches canvas, DOM and geometry consistently.
- [ ] Mount/destroy and two-editor lifecycle tests pass.
- [ ] Production browser checks and agreed performance budgets pass.
- [ ] Existing limitations and any remaining skips are documented accurately.
- [ ] Docs describe implemented interfaces, and replaced interfaces are removed.
