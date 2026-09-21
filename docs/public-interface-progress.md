# Public interface implementation progress

This log records execution of the [implementation plan](public-interface-implementation-plan.md).
The [repository map](repository-map.md) remains the target decomposition; its
directories and interfaces are not evidence of completed extraction.

## Milestone status

| Milestone                           | Status   | Required outcome                                                               |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------ |
| 0 — consumer contracts and baseline | Complete | Source inventory, consumer scenarios, production measurements and quality gate |
| 1 — model, transform and state      | Complete | Real ownership seams, acyclic imports and headless execution                   |
| 2 — typed schema assembly           | Complete | Extension-derived content types and synchronous Standard Schema validation     |
| 3 — session commands and state      | Complete | Shared named commands, draft chains, queries and per-session extension state   |
| 4 — complete view lifetime          | Pending  | Vanilla mounting owns rendering, input, assets and cleanup                     |
| 5 — presentation                    | Pending  | Per-view typography, fonts and appropriate cache invalidation                  |
| 6 — renderers and React             | Pending  | Public rendering/decorations and React adapters over the same view             |
| 7 — codecs and delayed edits        | Pending  | Extension codecs/input rules and durable async targets                         |
| 8 — workspace consumers             | Pending  | Built package exports, migrated demo and final performance verification        |

For each milestone, record the implementation commit, architecture judge findings,
accepted remedies and follow-up commit before beginning the next milestone. The
judge evaluates module depth, information hiding, locality and public interfaces;
passing tests alone does not establish those properties.

## Milestone 0: source ownership inventory

Baseline inspected on 2026-09-21. Implementation is under `src/`; workspace
discovery exists for `packages/*` and `apps/*`, but package extraction has not
started. The root still owns Vite, all quality tools and the single pnpm lockfile.

| Current module / entry point                                                                                              | Actual responsibility and consumer obligation                                                                                      | Intended owner                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/editor/index.ts`                                                                                                     | Broad barrel exposes schema, edits, session, selections, references and geometry together                                          | Narrow model/transform/state/core interfaces; view owns geometry                                |
| `src/editor/schema.ts`, `tree.ts`, `marks.ts`, `inline-schema.ts`, `schema-codec.ts`                                      | Generic schema and codec contracts; callers supply a manually typed node union and separate node/mark/inline registrations         | Model, with extension-derived composition                                                       |
| `src/editor/transactions.ts`                                                                                              | Defines steps and transactions, applies edits, checks permissions, publishes state, maintains history and constructs the session   | Transform for pure edit results; state for acceptance/history; core for convenient construction |
| `src/editor/anchors.ts`, `document-positions.ts`, `relative-positions.ts`, `relative-boundaries.ts`, `document-ranges.ts` | Snapshot coordinates, serializable references and revision-dependent resolution are adjacent and coupled through imports           | Value shapes below mapping; state owns retained resolution history                              |
| `src/editor-browser/index.ts`                                                                                             | `mountEditorView` owns event listeners, but requires pointer geometry and input handlers from its consumer                         | Private part of the complete view module                                                        |
| `src/editor-react/index.tsx`, `editor.tsx`, `use-canvas-input.ts`, `use-viewport.ts`                                      | React host/subscriptions plus native-input and viewport orchestration                                                              | React adapts framework-independent view controllers                                             |
| `src/editor-canvas/use-canvas-renderer.ts`                                                                                | React hook owns painting and canvas resource scheduling                                                                            | Complete view lifetime; React subscribes/mounts                                                 |
| `src/owned-layout.ts`, `owned-*`, `editor-scene.ts`                                                                       | Engine initialization, shaping/layout caches and document scene geometry                                                           | View implementation; consumers do not construct engines                                         |
| `src/extensions/demo-model.ts`, `demo-schema.ts`, `demo-codecs.ts`                                                        | Starter document union, schema definitions and codecs assembled independently                                                      | Concrete extensions and optional kit composition                                                |
| `src/extensions/starter-kit/actions.ts`, `input.ts`                                                                       | Starter commands and browser policy assembled by the demo around a document projection                                             | Commands contributed by extensions; native routing owned by view                                |
| `src/extensions/starter-kit/block-layer.tsx`, `use-document-layout.ts`, `types.ts`                                        | Rendering/layout and `Owned` engine types leak through starter interfaces                                                          | Browser contributions and private view implementation                                           |
| `src/extensions/table*`, `cell-selection.ts`, `clipboard.ts`                                                              | Table grid/selection, rich rectangular clipboard and React rendering                                                               | Table extension with independent headless/browser entry points                                  |
| `src/extensions/comment.ts`, `src/demo/app/use-comments.ts`                                                               | External threads and durable ranges are separate from document content; demo projects decorations                                  | Comment extension through public decoration contracts; application owns thread UI/store         |
| `src/demo/app/main.tsx`, `app.tsx`, `editor-workspace.tsx`                                                                | Application constructs CanvasKit and engine, creates session, coordinates input/layout/painting and passes resources through React | Demo keeps samples/toolbars/panels; session and view own editor behavior                        |

### Mutable resources and lifecycle

- `main.tsx` fetches CanvasKit and calls `createOwnedEngine(kit, 'shaping')`.
  The engine owns font/paint resources, paragraph caches and block sessions.
- `app.tsx` reuses that engine across samples and calls `flushSync` to unmount
  the old workspace before mounting the next one. Resource ordering is therefore
  a consumer responsibility today.
- `use-document-layout.ts` owns a scene cache and clears both it and the engine
  during cleanup. This is an explicit multi-editor isolation risk to test when
  view lifetime is extracted.
- The workspace owns session creation, canvas/input DOM refs, layout, painting,
  native input and selection wiring. The existing browser mount handles listener
  cleanup but cannot yet replace that assembly by itself.
- `use-sample-stream.ts` owns sample loading; sample selection belongs to the
  application, while document append/edit publication remains session behavior.

### Specialized policy and diagnostic consumers

Generic schema code dispatches on declared `text`/`container`/`atom` capabilities;
those are structural contracts rather than paragraph-specific rules. Concrete
starter policy still appears in `editor-scene.ts`: heading weight, a 4px baseline
grid and paragraph/heading branches. `extensions/typography.ts` has fixed heading
metrics; `table-view.tsx` separately assumes an 18px body size. Presentation
extraction must remove these competing sources of metrics.

`src/demo/app/use-diagnostics.ts` publishes `window.editorDiagnostics`. Current
Playwright E2E tests and `scripts/check-editor-*`, `benchmark-editor-*`,
`measure-editor-retention.mjs` and `report-editor-large.mjs` consume it. Preserve
those measurement capabilities through a dedicated diagnostic contract; do not
promote this application global into the ordinary editor interface. Root
`editor.html` and `extensions.html` both mount `src/demo/app/main.tsx`.

## Consumer scenarios to prove during extraction

Fixtures must exercise implemented interfaces as they arrive, never imports of
future exports that leave the mandatory gate red.

| Consumer               | Required observable contract                                                                                                                   | Existing evidence to preserve                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headless custom schema | Define a foreign node shape and attributes; validate unknown content; edit, undo and resolve references without DOM or graphics initialization | `tests/runtime-extensions.test.js`, `marks-codecs.test.js`, `foundation.test.js`                                                                                  |
| Vanilla browser        | Create a session and mount it into one element; type/select/paste with owned readiness and teardown; mount two independent editors             | Browser event/viewport tests currently cover pieces, not a complete public mount                                                                                  |
| React                  | Own or borrow a session, mount the same view, subscribe selectively and survive unmount/remount without destroying borrowed state              | `src/editor-react/__tests__/adapter-audit.browser.test.js` and full demo E2E                                                                                      |
| Custom extension       | Contribute a node, attribute mark and external-range decoration using supported package interfaces; render without starter-kit coupling        | `tests/marks-codecs.test.js`, `runtime-extensions.test.js`, `durable-document-ranges.test.js`; new composed-consumer fixture arrives with the supported interface |

The retained `checkExtensions` contract already exercises a headless foreign
schema at baseline. Target public-interface fixtures are introduced with their
implementing milestones, rather than creating another temporary consumer
interface solely to make milestone 0 appear complete.

## Test-discovery baseline

The baseline must compare project, file and test identity during relocation, not
just aggregate totals. A passing suite with missing discovery is a regression.

- `pnpm exec vitest run --project unit --reporter=json
--outputFile=/tmp/gprose-m0-unit-results.json`: **74 passed, one todo**, across
  11 files. This is actual execution, including expanded parameterized cases.
- `pnpm exec playwright test --list --reporter=json`: **39 collected cases**,
  13 per browser, across eight files. Collection does not prove execution.
- Browser Mode executes **30 cases**, ten each in Chromium, Firefox and WebKit,
  across eight source test files. Together with Node, the full Vitest run has
  **104 passed and one todo**.
- `vitest list --project unit` reports static declarations, which do not expand
  all parameterized cases and omit the todo; use executed assertion identities
  for the unit baseline.

| Unit file                                         | Passed | Todo |
| ------------------------------------------------- | -----: | ---: |
| `tests/document-codec.test.ts`                    |      1 |    0 |
| `tests/durable-document-ranges.test.js`           |      4 |    0 |
| `tests/foundation.test.js`                        |     31 |    1 |
| `tests/marks-codecs.test.js`                      |      4 |    0 |
| `tests/retained-contracts.test.ts`                |      4 |    0 |
| `tests/runtime-extensions.test.js`                |      7 |    0 |
| `tests/stored-marks.test.js`                      |      2 |    0 |
| `tests/structural-selection.test.js`              |      4 |    0 |
| `tests/table-clipboard.test.js`                   |      3 |    0 |
| `src/editor/__tests__/schema-codec.test.ts`       |     12 |    0 |
| `src/editor/__tests__/selection-adapters.test.js` |      2 |    0 |

The existing todo is **“concurrent split and insert converge with the insert
following moved text”** in `tests/foundation.test.js`. It is an unimplemented
concurrency contract, not a failure introduced by package extraction. Existing
accepted-revision replay tests do not establish concurrent OT/CRDT convergence.
Retain the explicit todo throughout these milestones unless that separate
behavior is actually implemented and verified.

Preserve the Node/browser split, React compiler, all three browser instances,
and isolated Playwright server at port 5174 with `strictPort` and
`reuseExistingServer: false`. Keep `pnpm run check` as the complete required gate.

Executed Vitest identities and collected E2E identities are recorded in
`artifacts/public-interface-m0/test-identities.json`. The Vitest JSON reporter
omits project labels; preserve repeated browser identities as a multiset alongside
the unchanged browser-project configuration.

## Milestone 0 gate and measurements

Root execution passed `pnpm run check`: lint, formatting, typecheck, project
ownership checks, **104 Vitest cases with one existing todo**, and **39
Playwright E2E cases**. The production build also passed.

Three serial production foundation trials are recorded in
`artifacts/public-interface-m0/baseline.json`; all existing budgets passed.
All 18 production reflow cases completed: three trials in Chromium, Firefox
and WebKit for both eager and viewport-first modes. Results are in
`artifacts/public-interface-m0/reflow.json`. No new performance budget is established by this inventory.

Production foundation worst values: firstUsableMs=181.00, streamingMs=1100.20, pasteHandlerMs=56.10, pastePaintMs=99.00, typingFrameMs=32.30, pagingFrameMs=32.30, loadedHeapBytes=28457096.00.

The historical budget report uses a development baseline; these production values
pass those existing limits but do not establish a like-for-like speedup. Future
milestone comparisons use the production baseline collected here.

### Reproducing the production measurements

The foundation and reflow artifacts were captured from runtime revision
`e23f035`; the retention follow-up uses `df59a78`, which changes measurement
scripts and documentation only. Each report records the capture time. Retention
also records its source revision and URL.

Build once, then keep this strict production preview running in a separate shell:

```sh
pnpm run build
pnpm exec vite preview --host 127.0.0.1 --port 5176 --strictPort
```

Run the benchmarks serially, without concurrent tests or development browsers
performing work. To reproduce without overwriting the committed baseline:

```sh
mkdir -p artifacts/public-interface-repeat
BASE_URL=http://127.0.0.1:5176 BENCHMARK_MODE=production REPORT_DIR=artifacts/public-interface-repeat pnpm run benchmark:editor-foundation
EDITOR_URL=http://127.0.0.1:5176/extensions.html REFLOW_REPORT=artifacts/public-interface-repeat/reflow.json pnpm run benchmark:editor-reflow
EDITOR_URL=http://127.0.0.1:5176/extensions.html BENCHMARK_MODE=production RETENTION_REPORT=artifacts/public-interface-repeat/retention.json pnpm run memory:editor
pnpm run check:editor-performance artifacts/public-interface-repeat/baseline.json
```

The committed capture used `artifacts/public-interface-m0` in place of
`artifacts/public-interface-repeat`. Foundation defaults to three trials and
records its environment and measurement method. Reflow runs three trials per
browser and layout mode. Retention measures 2,000 and 10,000 streamed blocks with
both full and viewport paragraph retention, repeated scrolling and width changes.
Its forced-GC JavaScript heap and backing storage figures exclude total process
and GPU memory.

### Milestone 0 architecture review

Implementation commit: `df59a78`. The independent judge applied
`improve-codebase-architecture` and accepted the ownership inventory and staged
consumer scenarios. It requested two changes before milestone 1: capture the
existing retained-memory benchmark and document exact production reproduction
commands. Both findings are accepted. The follow-up adds an output-path option
and revision metadata to the existing retention script, a retained result, and
the commands above. No runtime or quality-gate behavior changes.

Retention follow-up: all four cases passed with no stale paints or browser errors.
The viewport cache retained 48 composed paragraphs after scrolling and resizing,
for both document sizes. The full cache retained 1,800 and 9,000 respectively.
The complete heap/storage and geometry comparisons are preserved in
`artifacts/public-interface-m0/retention.json`.

## Milestone 1: model, transform and state

Milestone 0 review fixes were committed as `5d7c017` before this extraction.
The three real implementation modules are now `src/model`, `src/transform` and
`src/state`, each with an explicit entry point. Workspace manifests and built
exports remain milestone 8 work; no package forwards to implementation outside
its ownership.

- Model owns schema/tree mechanics, marks, inline values, codecs, coordinate
  values and independently serializable durable references.
- Transform owns document steps, application, identity-checked change inversion,
  numeric/key mappings and snapshot mapping. `applySteps` requires no session,
  selection, revision or history policy. Its result includes a validated tree
  index reused by state during selection acceptance.
- State owns transaction acceptance, selection publication, permissions, history,
  extension state and retained reference resolution. Stream-only append policy
  stays here. Appends now return invertible transform changes; stream transactions
  still exclude those changes from local history.
- Geometry-specific selection and keyboard helpers moved to the browser module.
  The previous low-level `src/model.ts` is named `src/layout-types.ts` to distinguish
  layout coordinates from the document model.

The former `src/editor` implementation and barrel are removed. Callers, browser
fixtures and diagnostic scripts import the owning public entry points. The shared
syntax-based checker covers imports, type imports, type queries, re-exports and
literal dynamic imports. Model can depend only on itself and Zod; transform can
also depend on model; state can also depend on transform. Cross-module private
imports and imports of the removed barrel fail the check.

Property updates preserve their batch path when no step observer is present.
When authorization is active, consecutive updates publish within the transform
one at a time so each permission check sees the previous update. Throwing aborts
before the editor publishes anything. This closes the old batch path's stale
permission view without imposing that cost on ordinary formatting.

`tests/headless-consumer.test.ts` exercises foreign-schema transformation,
inversion, append, step authorization, snapshot ownership and durable ranges in
the Node project without browser globals. The existing retained tests keep their
semantics. The schema codec's Date case now has a stable name instead of embedding
the capture time. `artifacts/public-interface-m1/test-relocations.json` explicitly
records both relocated test files and that one title change. Reproduce discovery
verification after collecting the two reporter outputs:

```sh
pnpm exec vitest run --reporter=json --outputFile=/tmp/gprose-tests.json
pnpm exec playwright test --list --reporter=json > /tmp/gprose-e2e.json
node scripts/check-test-discovery.mjs /tmp/gprose-tests.json /tmp/gprose-e2e.json artifacts/public-interface-m1/test-relocations.json
```

Three serial production foundation trials are preserved in
`artifacts/public-interface-m1`. These were captured from the implementation
worktree whose parent is `5d7c017`, before its milestone commit. All historical
budgets pass. Compared with the production M0 worst values: first usable paint
174ms versus 181ms, streaming 1,118.9ms versus 1,100.2ms, paste handler 59.6ms
versus 56.1ms, paste paint 103.1ms versus 99ms, typing 32.7ms versus 32.3ms,
paging 32.4ms versus 32.3ms, loaded heap 28,846,224 versus 28,457,096 bytes.
These small changes do not justify a new budget or a speedup claim.

The milestone gate passed: lint, format, typecheck, ownership checks, **108 Vitest
passes with the existing convergence todo**, and **39 Playwright passes**. The
production build passed. Discovery comparison preserved all 105 baseline Vitest
identities/statuses, including the todo and repeated browser identities, and all
39 E2E identities. The four new headless consumer cases account for the increase.

### Milestone 1 architecture review

Implementation commit: `a400102`. The independent judge and its explorer passed
milestone 1, finding real model/transform/state ownership and no introduced
mapping, permission, history or durable-reference regression. Its targeted
verification passed 39 relevant tests with the existing convergence todo.

Both suggested clarifications are accepted. `beforeStep` now receives a read-only
array and explicitly forbids mutation of nodes/steps. The transform interface
states that ordinary application reports descendant changes, while restoration
reports roots whose subtrees require invalidation. That distinction preserves
existing history behavior. Active README and session/extension documentation now
import the owning module instead of the removed barrel. Historical proposals and
baseline inventories retain their original paths as historical evidence.

## Milestone 2: assembly and runtime integration (in progress)

Milestone 1 review fixes were committed as `b20a27d`, with the complete gate
passing again. The official `@standard-schema/spec` 1.1.0 type package is now
installed for conformance and inferred input/output tests. The new assembly now
compiles both synchronous content validation and the runtime schema used by
transform and state. The starter kit now uses the assembled definitions too;
the retained custom-schema fixtures still exercise the old registration interface.
Completing their migration and behavior-definition factories remains required
before this milestone is complete.

The starter migration removed the parallel manual `StarterNode` union and the
separate codec attachment map. `starter-definitions.ts` owns attributes, child
constraints, marks and inline types; document aliases and constructors derive
from that assembly. Preserve versioned
saved documents, structured table children, custom text storage and the existing
transform/permission invariants. Whole-document validation belongs at import and
session creation, not ordinary typing. The standard permits promises, so the
editor must explicitly reject async validators in its synchronous contract.

The in-progress implementation includes reusable configured node, mark and inline
definitions. Static tuples infer recursive content, attribute defaults, mark
attributes and child constraints; runtime-loaded arrays expose a less specific
JSON content contract. Input may omit generated identities and empty child,
mark and inline arrays. Validated output owns a copied, deeply frozen document,
with immutable output types. Supplied numeric handles are reserved before
allocation; durable keys are preserved or newly generated.

Validation returns nested Standard Schema issues for invalid attributes, unknown
kinds, marks, inline positions, duplicate identities, cycles, child constraints
and conflicting mark ranges. Attribute validators control unknown attribute
fields; the fixtures use strict validators. Reserved identity/content fields
cannot be supplied by attribute normalization. Traversal stops at 256 nested
node levels or one million visited nodes, including invalid ones. Attribute
values must be JSON. Asynchronous validators fail synchronously and rejected
promises are observed without becoming unhandled rejections.

The runtime compiler derives text editing and custom container storage from the
same definitions. Grouped child arrays declare their grouping attribute; import
checks its agreement with array position. Text splits can select a declared
empty-text target with that target's defaults. A headless consumer exercises
replacement, split/join, history and retained positions with foreign text and
child field names. In a 2,000-node document, the typing fixture validates only the
edited node's attributes and preserves the other nodes' object identities.
Configured attribute restrictions apply to edits; a validator cannot silently
normalize edited text in a way that would invalidate position mappings.

The temporary `assembleSchema` entry point will replace the previous public
`createSchema` registration interface when default and retained consumers are
migrated. There is not yet a completed milestone commit or architecture review.

The integration checkpoint passed `pnpm run check`: lint, formatting, typecheck,
ownership checks, **128 Vitest passes with the existing convergence todo**, and
**39 Playwright passes** across Chromium, Firefox and WebKit. This establishes
the new headless assembly's compatibility with the current repository; it does
not establish migration of the demo, codec preservation or milestone completion.

### Starter-kit and persistence migration

The main demo now uses the generated runtime schema. The separate paragraph,
heading, quote and table runtime registrations and `demo-codecs.ts` are removed.
Mark and inline constructors retain installed names and inferred attributes.
The old handwritten text-replacement helper is also removed; core compilation
owns that behavior. Sample creation now replaces a node instead of mutating its
marks in place.

`tests/fixtures/starter-document-v1.json` was captured with the previous codec
before migration. It covers every starter node type, nested lists, table rows,
marks, inline mentions and node locking. The new codec both decodes the captured
document and reproduces its encoded representation exactly. The table definition
owns its small legacy row-length adapter; generic codecs own identity, children,
attribute validation and mark/inline version checks.

The first production benchmark caught a full-document copy failure not covered
by the existing smaller browser cases. The new split implementation spread the
entire identity argument, while clipboard slicing sometimes passes a full node.
That leaked a heading's `level` into the empty paragraph target and restored
source content during partial copies. Two minimal clipboard tests reproduced
both failures in all three browsers before the fix. Split now takes only `id`
and `key` from the identity source. The six browser cases then passed.

Grouped-child checks now run during final tree validation, allowing intermediate
structural steps to temporarily empty a row. This preserves rectangular table
paste operations while rejecting invalid final grouping. The complete gate after
these fixes and the copy optimization below passed **140 Vitest cases with the
existing convergence todo** and **39 Playwright cases**. The production build
passed.

The initial successful production trials also exposed a copy-time regression:
119–121ms versus 31–36ms at milestone 1, even though the established budgets
passed. Fully selected text blocks now reuse their existing immutable nodes;
only partially selected endpoints are sliced. Regression coverage distinguishes
selected empty paragraphs from a collapsed empty caret.

Three final serial production trials for this starter-migration checkpoint are
in `artifacts/public-interface-m2`. They were captured from the uncommitted
worktree whose parent is `b20a27d`; the report's commit field identifies that
parent, not a completed milestone commit. All existing budgets pass. Worst
values: first usable paint 181ms, streaming 1,099ms, paste handler 48.6ms, paste
paint 93.1ms, typing 32.4ms, paging 32.1ms, loaded heap 28,646,316 bytes. Copy now
takes 28.6–32.5ms across the three trials. These are checkpoint measurements;
repeat relevant measurements if the remaining milestone work changes runtime
behavior.

Before the milestone commit and judge: migrate retained custom-schema consumers
off array-based `createSchema`/`NodeExtension` registration, remove that public
legacy interface, finish reusable behavior-definition/state factories, and
review standalone container composition so default container definitions do not
force unrelated kit nodes to be installed. The node/mark/inline assembly and
starter-kit migration are implemented; those remaining requirements are not.

### Public schema migration checkpoint

All retained node-schema callers now use `createSchema({ extensions })`, including
headless consumers, foreign-field editing, nested-list and selection checks,
mark/inline codec tests and the four standalone diagnostics. The temporary
`assembleSchema` export and array-based constructor are gone. Runtime node types
are compiled capabilities; extension authors no longer implement `accepts`,
replace, split, join or container traversal. Runtime resolution uses a kind map.
The list command module no longer maintains a duplicate schema registration.

The assembled object retains its definition tuple, including each definition's
configuration API. Definition options expose recursively readonly types and are
cloned/frozen at runtime. Content groups compile once for validation and editing;
blockquote accepts installed block/list members and table cells accept installed
text-block members. Minimal paragraph/blockquote and paragraph/table kits have
coverage, so optional starter nodes are not accidental dependencies.

Retained assertions still cover imperative transform failures and opaque-value
permission comparisons. The latter uses a deliberately permissive low-level
schema adapter local to that test: Date values are not admitted into the public
JSON attribute schema. Codec round trips compare structural equality instead of
JSON property insertion order. Tests have not been removed or skipped.

The first complete migration gate passed 142 Vitest cases plus the existing
convergence todo, and all 39 E2E cases. The final configuration-ownership and minimal-table checkpoint passed
**144 Vitest cases plus the existing todo**, **39 E2E cases**, and the production
build. A second lint/format pass left source files unchanged.
ID allocation, bulk updates (37 assertions), find (40 assertions per browser),
and outline/streaming/responsive diagnostics passed on an isolated test server.
The user's port 5173 server was returning 504 Outdated Optimize Dep for its
cached dependencies; its process was left untouched. Diagnostic scripts now
accept BASE_URL so they can run against an independent test cache/server.

Remaining before the milestone commit and architecture judge: reusable behavior
definitions and per-session state factories, plus a final public-interface audit.
The public schema registration and standalone container requirements from the
previous checkpoint are now implemented. Milestone 2 is still incomplete.

Three serial production trials after the public API migration are recorded in
`artifacts/public-interface-m2/api-migration`. Every established budget passes:
first usable paint at most 175ms, streaming 1,088.1ms, paste handler 36ms,
paste paint 77.2ms, typing 32.3ms, paging 32.6ms, loaded heap 28,690,324 bytes.
As with the earlier checkpoint, the report identifies parent commit `b20a27d`;
these measurements cover the uncommitted migration, not a finished milestone.

### Milestone 2 implementation ready for review

`defineExtension` now supplies non-content behavior definitions with names,
dependencies, immutable configuration and per-session setup factories. Assembly
retains their exact types and validates names/dependencies without executing setup.
Behavior definitions neither enter document unions nor acquire persistence
versions. A headless two-session fixture verifies independent state fields and
separate updates from the same configured definition. The model does not import
state, commands or browser contracts; object-configured sessions will compose
these factories in milestone 3.

All milestone 2 implementation requirements are represented in source and tests.
Final validation and the required implementation commit precede the independent
architecture judge. Milestone 2 is not marked complete until that review and any
accepted fixes have been committed.

Final pre-review validation passed `pnpm run check`: **146 Vitest passes, one
unchanged convergence todo, and 39 Playwright passes**. `pnpm run build` passed.
The test-discovery audit preserved all 105 baseline Vitest identities and all
39 E2E identities before the two added behavior tests. The public registration
migration has no remaining array-constructor callers in source, tests or scripts.

### Milestone 2 architecture review

Implementation commit: `634fe99`. The independent judge requested three fixes:
canonical attribute validation, inferred inline projection attributes, and
immutable compiled descriptors. All three are accepted. The review confirmed
that behavior setup is a valid milestone 2 foundation and automatic session
composition remains milestone 3.

The attribute module now distinguishes import normalization from canonical
validation. Definitions with non-idempotent transformations supply
`outputAttributes`; its output type must agree with the import validator's output.
Import normalizes once and proves the result canonical. Edits, stored marks,
encoding and decoding validate canonical attributes without transforming them.
Without an explicit output validator, normalized output must pass the import
validator unchanged; otherwise validation reports the missing canonical contract.
Structural comparison avoids serializing attributes on the editing path.

`defineInline` takes `plainText` alongside `schema`, inferring normalized readonly
attributes from that schema and passing owned configured options. One private
adapter restores the erased attribute type after canonical validation. Authors
can write `attrs.label` directly instead of parsing their own known attributes.

Compiled node descriptors, editing/mark/codec/container functions, registries and
manifests are owned and frozen. The corresponding exposed types are readonly.
Regression tests cover normalized node/mark/inline round trips, non-idempotent
transforms, incompatible canonical types, configured inline callbacks, and
attempted descriptor mutation. Final verification and the post-review commit
remain pending at this checkpoint.

### Milestone 2 accepted fixes and final gate

The judge passed the follow-up review. Canonical validators now receive a
separate JSON value so a third-party validator cannot mutate persisted attributes
in place, including when it throws. Tests exercise both return and throw paths.
The final gate passed `pnpm run check`: **153 Vitest passes, one unchanged
convergence todo, and 39 Playwright passes**. The production build passed.

Three serial production trials after the review fixes are retained in
`artifacts/public-interface-m2/judge-fixes/baseline.json`. All established budgets
pass. Worst trial results: first usable 171ms, complete stream 1042.8ms, paste
handler 36.4ms, paste paint 78ms, typing frame 32.3ms, paging frame 32.3ms, and
loaded heap 28,764,216 bytes. Reports identify implementation commit `634fe99`;
they measure the working tree containing the accepted fixes before their commit.

The implementation and review cycle for milestone 2 is complete with this
post-review changeset. Session contribution composition remains milestone 3.

## Milestone 3: session composition and publication (architecture review pending)

Milestone 2's accepted review fixes were committed as `c3cdf8b` before this work.

`src/core` now owns the object-configured `createEditor({ schema, content })`
entry point. It composes behavior factories retained by the schema into named
commands, queries, selection extensions and fresh per-session state fields.
The public interface is explicit; it does not spread the state module's entire
implementation interface into the consumer's type. An imperative `transact`
command and raw `dispatch` remain available alongside named commands.

Named direct calls, chains and dry runs retain each installed command's argument
types. Command collisions report both owners. Queries are inferred separately;
`getCommandState` returns availability and activity independently, and
`selectedValue` distinguishes none, uniform and mixed values. Captured callbacks
read current state rather than a React render snapshot.

The session depends on the model's validated-content and editing contracts,
not its entire assembled mark/inline registry type. This prevents recursive
schema-type expansion while retaining input and output inference. Fixtures
include the complete starter schema with a table inside a quote.

At the state layer, nested commands now share the current draft. A nested false
result or a failed draft operation prevents partial publication, even if the
outer command ignores the result. Deferred effects run only after successful
publication and never during a dry run. Semantic `onUpdate` notifications precede
view invalidation subscriptions. Both channels snapshot their subscribers and
reject reentrant writes during publication.

Focused checks currently pass: **15 new tests** across the core session and
state publication fixtures, plus TypeScript's positive and negative consumer
contracts. The full `pnpm run check` gate passed for this checkpoint: **168
Vitest passes, one unchanged convergence todo, and 39 Playwright passes**.
The production build also passed, and a second lint-fix/format pass made no changes.
At that checkpoint, the main demo still used the existing action assembly.
The subsequent migration is recorded below.

Remaining at this initial checkpoint before milestone 3 could be judged:

- Complete native input and history command migration. Toolbar and input must
  invoke the same session commands. Prove StarterKit composes with foreign node
  definitions, including nested content, through the public authoring interface.
- Complete typed content/selection/lifecycle events, disposal and deferred
  focus/reveal behavior with one explicitly owned mounted view.
- Resolve history-provider capability ownership and conflicts.
- Retain permissions and durable-reference behavior through the remaining input
  and lifecycle migrations.
- Run complete quality, build, consumer and performance gates; commit, run the
  independent architecture judge, and commit any accepted fixes.

### Milestone 3 demo migration and draft consistency

The demo now constructs the public session with `starterExtensions` and canonical
`document` content. The old `starter-kit/actions.ts` and `use-editor-document.ts`
assemblies are deleted. Toolbar formatting, headings, quotes, lists, table edits,
selection replacement and rich fragment insertion use installed named commands.
A per-session document query owns tree and selection projection caches. The demo
adapter retains only feedback and focus around these commands. Native keyboard,
clipboard routing and history still need their complete migration.

Canonical `document` initialization validates persisted attributes without
running import normalization again. Command drafts own identity allocation, so
availability queries never consume persistent node handles. Starter composition
receives its assembled schema through the setup context. Table formatting keeps
focus in the selected cell's textarea, verified in all three browsers.

Draft fields now reduce the cumulative transaction from its original snapshot,
while document transformation applies only newly appended steps. Multiple draft
steps share one revision. The final preview has the same transaction metadata,
position maps and field values as publication. Stored-mark-only commands retain
their existing notification kind and revision. Tests cover nested edits, retained
intermediate snapshots, dry runs and the final published event. The full gate at
this checkpoint passed 175 Vitest tests, the unchanged convergence todo, all 39
Playwright scenarios and the production build.

Node, mark and inline definitions now accept per-session `setup` contributions,
with the same configured-option and command/query inference as behavior
extensions. The model retains factories without importing session contracts;
core executes installed factories from the single assembled definition list.
Consumer tests cover configured contributions and isolated transactional fields
in two sessions sharing the same schema.

The first production performance attempt caught an expensive select-all toolbar
query during the large-document paste/undo sequence. A minimized headless
regression observed 812 range resolutions for 200 selected paragraphs. Caching
the document projection by immutable editor snapshot prevents each ancestor
query from recomputing the complete selection. The regression now passes with a
bounded number of range resolutions. The complete check and production build
passed afterward: **177 Vitest passes, one unchanged convergence todo, and 39
Playwright passes**.

Three serial production trials are retained in
`artifacts/public-interface-m3/toolbar-migration/baseline.json`. They exercise
copy/paste of the complete book, duplicate-content checks, undo/redo, typing,
paging and retained heap. All existing budgets pass. Worst trial results:
first usable 174ms, complete stream 1037.9ms, paste handler 42ms, paste paint
79.1ms, typing and paging frames 32.3ms, loaded heap 28,909,668 bytes. Reports
identify `c3cdf8b` but measure this uncommitted milestone 3 working tree. Milestone
3 remains in progress and has not yet received its commit/judge cycle.

A temporary compile-only consumer probe also confirmed a remaining composition
problem: adding a foreign `banner` node to `starterExtensions` makes session
construction fail with `incompatibleSessionContribution`. The starter editing
factory still assumes the closed `StarterNode` union. The probe was removed after
recording this evidence. The next authoring change must let concrete policies
operate safely alongside foreign nodes and nested containers; weakening the
compatibility check or asserting the broader document to `StarterNode` would
hide the problem. This remains a milestone 3 requirement, alongside native input,
history ownership and lifecycle effects.

### Milestone 3 portable contributions and structural policies

Commands, activity checks and queries now receive the executing schema with the
current state. The public `defineCommand` and `defineQuery` builders preserve
portable generic callbacks while inferring user-facing arguments and results.
Capturing a generic schema in the configuration wrapper had erased its node
parameter; execution context avoids that loss. Closed-schema contributions remain
checked against the assembled document rather than being widened by assertion.

Starter formatting is a separate contribution and uses the active schema's text
and mark capabilities. It no longer imports the global demo schema. A typed
consumer installs it alongside a node-owned command, a custom text node with
`value`/`styles` storage, and a custom atom inside a quote. Availability, activity,
clearing, undo and inferred arguments work through the public session.

Quote/list structural algorithms now accept a concrete node policy and the
executing schema. List construction no longer captures a second schema's child
writer. A second policy uses `quotation`, `sequence` and `entry` node names with
`body`, `items` and `blocks` child fields. Named commands preserve nested custom
atoms through wrapping, indentation, toggles, undo and redo. This exercises the
same algorithm as the starter implementation.

That test exposed a quote bug: a selection spanning list items chose the list as
its insertion container and replaced its items with a quote. The command now
lifts that insertion to the list's parent, keeping the list intact inside the
quote. Non-sibling list wrapping returns unavailable without throwing.

The complete starter factory is not yet portable. Its constructors, heading and
table edits, document projection and clipboard policies still use `StarterNode`.
This checkpoint removes shared algorithm and formatting assumptions; it does not
claim the complete StarterKit/custom-node composition requirement is finished.

A second regression test measures work for quoting a large sibling selection.
The old parent-range scan read identities 20,500 times for 200 nodes. A child
index replaces that quadratic scan; the test enforces a linear visit budget.
A compile-only negative case also confirms closed-node commands are still
rejected when mixed with foreign nodes. Portable builders do not weaken that
check.

Verification passed **183 Vitest tests, one unchanged convergence todo, all 39
Playwright scenarios, and the production build**. Three additional serial
production trials are retained in
`artifacts/public-interface-m3/portable-formatting/baseline.json`; all existing
budgets pass. Worst results: first usable 173ms, complete stream 1053.9ms, paste
handler 41.9ms, paste paint 91.6ms, typing 32.3ms, paging 32.4ms, loaded heap
28,955,056 bytes. These artifacts identify `c3cdf8b` and measure this uncommitted
milestone 3 working tree. No milestone 3 completion or judge pass is claimed.

### Milestone 3 schema-bound construction and structural contributions

`schema.node(definition)` now binds typed attribute creation and reads to the
installed definition family. Configured variants retain their installed
validators; a different definition reusing the same name is rejected. Input
attributes are normalized once, cloned and frozen. Reads expose only canonical
attributes, excluding identity and storage fields, and use a weak cache rather
than repeated validation. Constructors own their child sequences and initialize
text storage; document insertion validates structural placement and identities.

Starter heading, quote/list and table contributions now use the executing schema.
Heading conversion transfers text, marks and inline mentions through the target
editing policy while retaining identity, locks and durable positions. It handles
selected containers and leaves custom text node types unchanged. Table insertion
and row/column growth preserve foreign cell content, rectangular selections and
unchanged cell identities. All table-builder callers migrated to schema-bound
construction; mutable clipboard fixtures explicitly clone the resulting values.

Portable consumer tests exercise custom `value`/`styles` text, custom atoms,
nested wrapping, heading conversion with inline mentions, table cell formatting,
structural changes, dry runs and atomic undo/redo. The browser gate caught a
regression where the final empty cell of a rectangular selection was treated as
an excluded text endpoint. Endpoint exclusion now applies only to contiguous
text/range selections, with a headless regression covering both empty end cells.

The full check passed **191 Vitest tests, one unchanged convergence todo, and all
39 Playwright scenarios**; the production build passed. The complete starter kit
still needs portable document projection and clipboard policies, along with the
remaining native-input, history-ownership and lifecycle work. Milestone 3 is not
yet complete and has not received its commit/judge cycle.

Three serial production trials are retained in
`artifacts/public-interface-m3/schema-bound-commands/baseline.json`. All existing
budgets pass. Worst results: first usable 180ms, complete stream 1088.8ms, paste
handler 42.3ms, paste paint 106.2ms, typing and paging 32.3ms, loaded heap
28,903,240 bytes. Paste paint is higher than the preceding 91.6ms checkpoint,
within the unchanged 123.1ms budget; repeated structural query indexing remains
an optimization candidate as document projection moves out of the closed starter
factory. These artifacts identify `c3cdf8b` and measure the uncommitted milestone
3 working tree.

### Milestone 3 generic clipboard algorithms and live input routing

The model now owns canonical subtree copying through `schema.copy(node, allocate)`.
It traverses declared child storage, refreshes node and inline identities, retains
locks and canonical attributes, and does not replay import normalization. Tests
cover alternative text/mark/inline fields and a non-idempotent attribute importer.

Rich fragment insertion, rectangular table paste, plain paragraph insertion and
cross-container replacement now accept the executing schema's node type. Custom
text survives inline paste and table growth with marks and inline mentions intact;
untouched source nodes and destination cells retain identity. Cross-container
replacement handles custom text and intervening atoms. Headless consumer tests
exercise these operations through the public transaction API, including undo and
redo. Browser codecs remain tied to starter definitions and still need migration.

Renderer document projection is no longer registered as a session query. The
view consumer owns its cached projector. Native handlers no longer receive a
captured document snapshot or use the global demo schema. Rich and rectangular
paste route through the named session paste command. A retained-handler browser
regression verifies current-selection copy, rich paste and atomic undo without
React rendering or handler rebinding, in Chromium, Firefox and WebKit.

The full check and production build passed: **198 Vitest tests, one unchanged
convergence todo, and 39 Playwright scenarios**. The remaining starter factory
constraint is its node-valued command arguments (`updateNode` and `paste`), which
still declare the closed starter node union. Generic implementation alone does
not satisfy the complete StarterKit/custom-schema composition requirement.
Native text/split/delete commands, history ownership and lifecycle publication
also remain before milestone 3 can be committed and judged.

The first three production trials through the shared paste command passed the
unchanged budgets but approached the paste limit: 61ms handler and 117.4ms paint
(`artifacts/public-interface-m3/portable-clipboard/baseline.json`). The native
handler had unnecessarily projected the whole document before a rich paste.
It now projects only for plain-text fallback; keyboard shortcuts/navigation also
run before structural projection.

`CommandContext.apply({ steps, selection, storedMarks })` now applies a complete
edit in one draft transition. Paste, replacement, list indentation and table
insertion use it instead of separate content and selection previews. The
primitive also replaces duplicated implementations of step/selection/stored-mark
updates. A transactional-field regression requires inserted content and its
selection to arrive together, and verifies dry-run isolation and atomic undo.

The complete check and production build passed afterward: **199 Vitest tests,
one unchanged convergence todo, and all 39 Playwright scenarios**.

Three final production trials are retained in
`artifacts/public-interface-m3/atomic-clipboard/baseline.json`. All unchanged
budgets pass: first usable 175ms, complete stream 1082.7ms, paste handler 55.3ms,
paste paint 113.6ms, typing 29.5ms, paging 32.7ms, loaded heap 28,995,904 bytes.
The combined draft operation and delayed projection reduce the preceding 61ms
paste-handler result while keeping the shared session-command route. Reports
identify `c3cdf8b` and measure this milestone 3 checkpoint before its commit.

This is an implementation checkpoint, not milestone 3 completion. The milestone
judge must review all work since the milestone 2 reviewed baseline `c3cdf8b`,
including this checkpoint and the remaining implementation, after milestone 3's
full exit criteria are met.

### Milestone 3 native input drafts and session events

Native input now publishes through `editor.transact`, with history group/time
options shared by named chains and dry runs. Input edits capture marks from the
current draft and store them on individual replacement operations. A chain can
change formatting between insertions, replay the published transaction into a
second session, and retain identical formatting through undo/redo. Plain text
nodes accept unmarked input without requiring a mark adapter. Unsupported
explicit marks reject atomically. Native split/delete policy construction still
needs migration from browser handlers into extension contributions.

`editor.on(name, listener)` replaces the narrower `onUpdate` interface. Typed
channels distinguish transaction/mapping updates, content changes, selection
changes and destruction. All channel listeners are snapshotted before callbacks;
semantic publication precedes view invalidation. Availability queries remain
usable during publication, but recursive edits and destruction are rejected.
Persistence listeners can subscribe to content without receiving caret changes.

Session `destroy()` is idempotent, clears subscriptions/history/journal, and
rejects future editing, new subscriptions, dry runs and already-prepared command
chains. The final snapshot and pure queries remain readable. Destroying one
session leaves another session using the same schema independent. The mounted
view and extension resource cleanup still need integration with this lifecycle.

The full check and production build passed with **206 Vitest tests, one unchanged
convergence todo, and all 39 Playwright scenarios**. Tests exercise per-operation
mark replay, history grouping and preview metadata, public event ordering and
snapshot listeners, availability during publication, terminal disposal and
session independence. No lint or test configuration was relaxed.

The input-command performance checkpoint passed every unchanged budget over
three production trials (`artifacts/public-interface-m3/input-commands/baseline.json`):
first usable 200ms, complete stream 1067ms, paste handler 55ms, paste paint 112ms,
typing 29.4ms, paging 32.5ms, loaded heap 28,983,452 bytes. Reports identify
`93a25b5` and measure the uncommitted input-command implementation.

This remains an intermediate milestone 3 checkpoint. Deferred view effects,
history provider ownership, fully portable starter command arguments, remaining
native command contributions and public snapshot contracts still need work.
The milestone judge must review the complete change since `c3cdf8b` after those
exit requirements are met.

Final production trials with session events also pass every unchanged budget
(`artifacts/public-interface-m3/session-events/baseline.json`): first usable
175ms, complete stream 1078.6ms, paste handler 56ms, paste paint 115.2ms, typing
29.6ms, paging 32.6ms, loaded heap 28,966,720 bytes. These reports identify
`93a25b5` and measure this checkpoint before commit. A second lint-fix/format
pass changed no files.

### Milestone 3 complete starter composition and native commands

The complete `starterExtensions` assembly now composes with foreign text and atom
nodes. `defineDocumentCommand` binds canonical-node arguments to the consuming
schema through a type-only argument interface. Direct commands, chains, dry runs
and activity queries all preserve the same assembled node type. Compile-time
fixtures reject unknown node kinds and missing attributes. Ordinary commands
retain inferred arguments through `defineCommand`; no runtime serialization or
extra content parsing was added.

Starter paste and node-update commands no longer capture `StarterNode` or a fixed
schema. Foreign text with alternative text/mark/inline fields survives named rich
paste, rectangular table paste and table growth. Custom atom updates, paragraph
replacement and cross-container replacement work through the complete kit, with
atomic undo and unchanged dry-run state.

Native typing, Enter, backward/forward deletion, plain-text paste and explicit
native table edits now invoke named session commands. The browser handler no
longer constructs split, join, replacement or list steps. The demo's imperative
step-dispatch and structural callback wrappers were removed. Input handlers keep
event routing, text normalization and composition/history grouping; clipboard
codecs and renderer projection still use starter-specific content.

Headless regression tests cover custom text storage, grapheme deletion, stored
marks through list splitting, joining a later paragraph within a list item,
empty-quote exit, cross-block replacement/splitting in one undo entry, cell
boundaries and permissions. Explicit native targets preserve their reported
caret without inheriting stored marks from a different text node. Plain-text
paste now handles paragraphs within the selected table cell. Retained-handler
browser tests verify Enter, Backspace and ordinary typing without rebinding or a
React render.

Declaration emission uncovered pre-existing anonymous recursive definition types
and internal symbols that TypeScript could not name. `ContentDefinition` and
`BehaviorDefinition` now give those recursive contracts names without erasing
concrete schema or command types. The command argument binding also has a named
exported contract. `check:declarations` emits declarations into a temporary folder
and removes it afterward; `pnpm run check` now includes this gate. This adds a
check rather than relaxing linting, typechecking or any test suite.

Milestone 3 still requires deferred view effects, history-provider ownership,
extension resource cleanup and the public snapshot contract review before its
completion commit and architecture judge. The judge baseline remains `c3cdf8b`.

The final full check, declaration emission and production build passed with
**217 Vitest tests, one unchanged convergence todo, and all 39 Playwright
scenarios**. The second lint-fix/format pass changed no files. Three production
trials in `artifacts/public-interface-m3/native-commands/baseline.json` passed
all unchanged budgets: first usable 175ms, full stream 1081.5ms, paste handler
55.5ms, paste paint 114.1ms, typing 32.7ms, paging 32.9ms, loaded heap 28,977,404
bytes. The report identifies `0e2be8a` and measures this uncommitted native-command
implementation before its declaration-only contract refinements.

### Milestone 3 session-owned view effects

Every composed session now includes `focus` and `scrollIntoView` commands with
the same direct, chained and dry-run interfaces as extension commands. Effects
run after publication, in command order, against the final selection. Headless
requests are successful no-ops and do not create a transaction or undo entry.
Failed and stale chains never invoke their queued view effects.

`connectEditorView` gives the adapter one attachment per session. Detachment is
idempotent and leaves the session alive. Effects capture that attachment and
never transfer to a replacement view. Session destruction releases its view
before application lifecycle observers. Duplicate attachment and collisions with
session-owned command names reject explicitly.

The native view connects this lifecycle, releases event listeners when its
session is destroyed, cleans up listeners after rejected duplicate mounts, and
rejects changing sessions in place. The React host remounts when given another
session, skips updates to a destroyed view, and tolerates rendering or mounting a
closed borrowed session. The canvas hook schedules explicit reveal requests even
without a content or selection change. Toolbar focus now uses the session command
instead of accepting an application focus callback. Layout, font and graphics
resource ownership still belong to milestone 4's broader view migration.

An inline `defineNode(...)` inside `createSchema(...)` exposed backwards inference
from the assembly's erased callback type into definition setup arguments. Builder
return contracts now block that contextual inference while retaining input-driven
literal names, attributes and contribution types. Browser fixtures exercise the
inline construction form; existing closed-schema rejection and typed command
fixtures still pass. The independent selection fixture uses its explicit closed
container-kind union instead of an unnecessary generic factory parameter.

Milestone 3 remains incomplete. History-provider ownership, extension factory
cleanup and the public snapshot contract review remain before the milestone
completion commit and architecture judge. The judge baseline remains `c3cdf8b`.

The final full check, declaration emission and production build passed with
**231 Vitest tests, one unchanged convergence todo, and all 39 Playwright
scenarios**. Tests cover effect order, final-selection reveal, pure dry runs,
headless no-ops, failed/stale chains, attachment replacement, duplicate mounts,
listener cleanup, session destruction, React session replacement and closed
session rendering. A second lint-fix/format pass changed no source files.

Three final production trials in
`artifacts/public-interface-m3/view-effects/baseline.json` pass every unchanged
budget: first usable 177ms, full stream 1084.1ms, paste handler 55.7ms, paste paint
116.2ms, typing 32.4ms, paging 32.5ms, loaded heap 29,018,764 bytes. The report
identifies `9db6201` and measures this checkpoint's uncommitted working tree.

### Milestone 3 extension lifetime and snapshot contract

Factories can register resources with `ExtensionContext.onDestroy` as soon as
those resources are acquired. Session destruction disposes its view first,
extension resources in reverse registration order, then application observers.
Cleanup is idempotent, attempts every callback, and releases late registrations
immediately. Failed initialization also disposes resources from the throwing
factory and all earlier factories, including failures while initializing fields
or registering commands and queries. Initialization and cleanup errors remain
available together in an aggregate error.

`EditorState` now exposes readonly fields and readonly document arrays. The
transform functions and lower state constructor accept readonly documents,
preserving unchanged node identities. Command previews create their final
revision-bearing snapshot before projecting fields instead of mutating an
already-created snapshot. Tests exercise frozen input arrays/nodes, undo/redo,
structural sharing, stable draft revisions and matching field/mapping snapshots.
No whole-document freeze or copy was added to editing.

Inline `createSchema` inside `createEditor` exposed contextual inference from the
session's erased construction contract. The schema builder's return type now
uses `NoInfer`, retaining inference from installed extensions while preventing
that backwards inference. The resource-lifetime fixture exercises the inline
construction form; existing schema, command and declaration tests also pass.

Full checks, declaration emission and production build passed: **238 Vitest
tests, one unchanged convergence todo, and 39 Playwright scenarios**. Three
production trials in
`artifacts/public-interface-m3/extension-lifetime/baseline.json` passed all
unchanged budgets: first usable 175ms, full stream 1079ms, paste handler 55.7ms,
paste paint 114ms, typing 32.2ms, paging 33.1ms, loaded heap 28,984,240 bytes.
The report identifies `f735ac1` and measures this checkpoint's uncommitted tree.

Milestone 3 remains in progress. History-provider ownership and the migration of
undo/redo into extension commands remain before the completion commit and
architecture judge. The judge must review the complete milestone since `c3cdf8b`.

### Milestone 3 explicit local-history ownership

Composed sessions now retain local undo history only when one installed extension
contributes `history` configuration. StarterKit installs `localHistory`; custom
assemblies can configure its retention depth and grouping delay. Multiple owners
reject before state construction and use the existing failed-initialization
cleanup path. Sessions sharing a configured definition keep independent stacks.
A session without history still maps durable positions and publishes edits.

The state module's `local-history.ts` owns undo groups, retention, composition
coalescing and replay preparation. Replay preparation does not mutate either
stack. State validates the restored document, selection and permissions and
prepares fields before accepting the replay. A rejected undo or redo leaves the
snapshot, stack and position checkpoint intact, and a later retry succeeds.
The low-level imperative state constructor retains its default local history;
`history: null` disables it. The composed extension interface accepts local policy
configuration, not arbitrary callbacks that can interrupt publication. General
collaborative history remains outside this implementation.

Full checks, declaration emission and production build passed with **243 Vitest
tests, one unchanged convergence todo, and 39 Playwright scenarios**. A subsequent
replay-rejection regression also passed with the complete six-test history suite
and typecheck, bringing the suite total to 244 passing tests. Tests cover no-history
sessions, durable-position independence, retained depth, configurable grouping,
composition, independent sessions, conflicting owners and invalid options.

Three serial production trials in
`artifacts/public-interface-m3/history-ownership/baseline.json` pass all unchanged
budgets: first usable 174ms, full stream 1079.7ms, paste handler 54.7ms, paste paint
113.5ms, typing 32.4ms, paging 32.4ms, loaded heap 29,021,644 bytes. The report
identifies `b3e09ad` and measures this checkpoint's uncommitted implementation.

Milestone 3 remains in progress. Undo/redo still need named command contributions
with accurate dry runs and atomic command semantics before the completion commit
and independent architecture judge. That judge's baseline remains `c3cdf8b`.

### Milestone 3 implementation completion: named history commands

`localHistory` now contributes typed `commands.undo/redo`, matching chain and dry-run
forms, and command-state availability. The demo toolbar, keyboard/native input
callbacks and retained consumers use those commands. Separate composed-session
`undo/redo` methods were removed; the imperative state module retains its lower-level
operations.

History commands prepare one replay without moving stacks or publishing. Following
read-only commands inspect the prepared state. Dry runs, failed commands, stale
snapshots, changed history boundaries and permission revocation leave document,
stacks, references and queued effects unchanged. Final publication rechecks current
permissions and extension reducers. Replays use one prepared document/tree rather
than reconstructing it for both preview and execution.

The chain contract explicitly distinguishes replay from a new edit. One replay may
accompany view effects and read-only commands. New content, selection or stored-mark
edits, or another replay, must be separate calls; mixing them rejects the complete
chain. Ordinary edit chains still publish as one undoable transaction.

Milestone 3 acceptance evidence:

| Requirement                                                             | Implementation and verification                                                                                                                                        |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One object-configured session from the assembly                         | `core/session.ts`; compiled positive/negative fixtures and `core/__tests__/session.test.ts`                                                                            |
| Named, direct, chained and dry-run commands; queries and activity       | `core/commands.ts`, `queries.ts`, `definitions.ts`; session and portable-extension tests                                                                               |
| Full starter composition and native input migration                     | `extensions/starter-kit`; foreign-node text/clipboard/block fixtures; `tests/starter-input.browser.test.ts`; demo controls and E2E typing/clipboard/structure coverage |
| Draft visibility, atomic edits, rollback, permissions and stale callers | `state/commands.ts`; state command-publication, core session and history fixtures                                                                                      |
| Deferred focus/reveal and one view per session                          | `core/view-effects.ts`; headless, native browser and React session-lifetime tests                                                                                      |
| Typed events, cleanup, ordering and independent extension storage       | `state/events.ts`, core extension-lifetime; publication and factory-lifetime fixtures                                                                                  |
| Readonly snapshots; options, fields and document data distinct          | readonly state/transform contracts; compiled fixtures and frozen-input structural-sharing tests                                                                        |
| One history owner with configurable local policy                        | `extensions/history.ts`, `state/local-history.ts`; history ownership, grouping, retention, replay and denial fixtures                                                  |

All milestone 3 implementation checkpoints since `c3cdf8b` belong to the independent
architecture review, including command composition, portable constructors and
clipboard, native input, events, disposal, view effects and history. Milestones 4–8
remain pending. The unchanged concurrent split/insert todo belongs to the separate
collaboration plan and is not claimed as solved.

Final milestone 3 implementation validation passed: `pnpm run check`, declaration
emission and production build, with **249 Vitest passes, one unchanged convergence
todo, and all 39 Playwright scenarios**. The final regression includes invalidating
a prepared replay when the history boundary changes without a new snapshot.

Three serial final production trials in
`artifacts/public-interface-m3/history-commands-final/baseline.json` pass every
unchanged budget: first usable 176ms, full stream 1078.9ms, paste handler 56.5ms,
paste paint 117.3ms, typing 32.4ms, paging 32.7ms and loaded heap 29,514,128 bytes.
Removing duplicate restored-document preparation reduced the prior trial's
122.5ms paste paint to 117.3ms while retaining final permission/field validation.
Both reports identify `b74f3b0` and measure their respective uncommitted trees.
The pre-review commit covers the completed implementation; milestone acceptance
still requires the judge and any agreed fixes.

### Milestone 3 judge fixes and acceptance

The independent judge reviewed `c3cdf8b..5ad50fe` and required two fixes at the
composition seam. Conditional/optional commands and queries could appear as
required methods despite being absent at runtime. Session schema types also
omitted the assembly's typed mark and inline factories.

Composition now checks each tuple slot for stable, finite string capability names
and callable signatures. Disabled features retain their methods and report
availability through execution/`can()`. Variable-length assemblies do not claim
statically installed names. Content-definition builders retain their normal
setup inference; their internal absent-factory path does not make supplied
contributions optional. Negative consumer fixtures cover optional factories,
namespace/member/name alternatives, changing signatures, symbol/numeric names,
index signatures and dynamic assemblies. Existing configured node, mark and
inline contribution fixtures remain positive.

`SchemaValues` keeps the model-owned typed factories available through both
`schema` and `editor.schema`, without forcing recursive node inference into the
session overload. Consumer fixtures verify installed discriminants and attributes,
reject unknown names/invalid attributes and confirm the schema identity is
unchanged. The judge's full report and resolution are in
[milestone-3-architecture-review.md](milestone-3-architecture-review.md).

Post-review full checks and production build passed: **253 Vitest passes, one
unchanged convergence todo and all 39 Playwright scenarios**. Final type-only
name-validation additions were also typechecked and linted. Production runtime
code is unchanged by these fixes; the final pre-review three-trial performance
report remains applicable. README and session examples now describe the composed
session interface. The post-review commit closes milestone 3; milestone 4 owns
the remaining complete view lifecycle and demo assembly removal.

## Milestone 4: framework-independent paint ownership (in progress)

The native paint owner is now `editor-canvas/canvas-renderer.ts`. It owns surfaces,
paints, registration identity, the pending animation frame and draw cleanup. The
React hook moved to `editor-react` and only attaches the controller and sends
frames. The canvas module no longer imports React, enforced by the app dependency
check. Painter contracts also belong to canvas; React re-exports them for its
optional component adapter.

Attachments release native resources, cancel queued frames and drop their last
frame's document references. The controller can attach again, while terminal
`destroy()` rejects further use. Stale detach callbacks and replaced painter
registrations cannot remove their successors. Destruction inside a painter
retires its resources only after the current draw unwinds, preserving balanced
canvas state. Diagnostics expose a readonly painter count instead of a mutable
registration map.

Real CanvasKit browser fixtures cover actual painted pixels, coalesced updates,
resize/remount, native paint deletion, cancellation, stale cleanup and destruction
during drawing. All nine focused cases passed in Chromium, Firefox and WebKit.
This is an implementation checkpoint, not milestone 4 acceptance: layout, input,
assets, scene/cache ownership, complete public mounting and demo simplification
still remain before its independent judge.

Checkpoint validation passed `pnpm run check` and production build: **262 Vitest
passes, one unchanged convergence todo, and all 39 Playwright scenarios**. A
source edit during an intermediate browser run triggered Vite hot reload and
invalidated that run; the complete fixed-tree rerun passed. The three serial
production trials in
`artifacts/public-interface-m4/paint-controller/baseline.json` pass every unchanged
budget: first usable 177ms, streaming 1097.7ms, paste handler 57.9ms, paste paint
120.7ms, typing 32.4ms, paging 32.5ms and loaded heap 28,964,020 bytes. The report
identifies `30e2f39` and measures this checkpoint's uncommitted tree.

### Milestone 4 isolated layout owners and resource cleanup

Paragraph cache ownership now follows each scene, independently of the shared
font/WASM resources. Layout owners have local node-ID maps and explicit cache
release/destruction; clearing one cannot evict another with the same IDs. Scene
clear drops the whole owner, including navigation-only layouts. Mention labels
use temporary, uncached snapshots rather than the global reserved ID `900000`.
All direct callers migrated; the root engine's global layout/clear interface was
removed.

Resource destruction is idempotent and releases fonts, faces, paint, block
sessions, caches and its WASM reference. Partial native font initialization cleans
up acquired resources. Published geometry remains readable, while stale drawing
or shaping rejects after resource destruction. The demo now replaces workspaces
by generation without `flushSync`; cache isolation makes React cleanup order
irrelevant to the successor's retained layout.

Validation passed `pnpm run check` and production build: **271 Vitest passes, one
unchanged convergence todo and 42 Playwright scenarios**. Real browser fixtures
exercise identical IDs across owners/scenes, cache eviction and width changes,
retained snapshots, terminal destruction and label retention. The new E2E case
switches samples repeatedly, uses back/forward, verifies only one live layout
owner, checks typing still works and confirms WASM/fonts are not fetched again.

Three serial production trials in
`artifacts/public-interface-m4/layout-owners/baseline.json` pass every unchanged
budget: first usable 176ms, streaming 1060.1ms, paste handler 56.1ms, paste paint
115.7ms, typing 32.6ms, paging 32.9ms and loaded heap 29,530,844 bytes. The report
identifies `5443b2d` and measures this checkpoint's uncommitted tree. Milestone 4
still requires complete mounting, asset lifecycle, input and layout controllers
before its independent architecture judge.

### Milestone 4 native input controller

`editor-browser/canvas-input.ts` now owns pointer/navigation binding, hidden
textarea positioning/synchronization, native Select All and caret reveal. The
React hook only attaches the controller and supplies committed layout frames.
Reveal requests have their own scheduling and wait for geometry matching the
current session selection; they no longer require an artificial React render.

Input attachments cancel pending composition/reveal work and release capture and
frame references. Stale detach callbacks cannot remove a successor. Terminal
controller/text-input destruction is idempotent, removes listeners and rejects
stale mutation callbacks. It does not destroy the borrowed editor session.

Validation passed `pnpm run check` and production build: **283 Vitest passes, one
unchanged convergence todo and 42 Playwright scenarios**. Twelve focused browser
cases exercise the imperative controller without React. The existing navigation,
page-scroll and pointer audits also passed across Chromium, Firefox and WebKit,
including 1100px/390px layouts, shift/modifier navigation, PageUp/PageDown, distant
boundaries, full-area clicks, interactive controls, resizing and undo.

Three serial production trials in
`artifacts/public-interface-m4/input-controller/baseline.json` pass every unchanged
budget: first usable 174ms, streaming 1074.6ms, paste handler 55.7ms, paste paint
119.3ms, typing 32.2ms, paging 32.8ms and loaded heap 29,069,368 bytes. The report
identifies `8d30c3b` and measures this checkpoint's uncommitted tree. Complete
mounting, layout scheduling and asset readiness/cancellation remain before the
milestone 4 architecture review.

### Milestone 4 document layout controller

`createDocumentLayout` now owns document observation, widget measurements, caret
geometry, viewport culling, scene publication and background reflow. Its source
contract is a snapshot getter and subscription, with no React dependency. The
35-line React hook attaches the controller, subscribes to snapshots and
acknowledges their DOM placement. Demo diagnostics use read-only controller
getters; the scene cache and mutable measurement/width refs no longer escape.

Document notifications coalesce in a microtask, outside the transaction call
stack. Background composition queues after the host can submit painting.
Callback-only frame updates do not rebuild layout. Detaching removes the source
subscription, cancels queued/RAF work and releases the scene's layout owner.
Stale cleanup cannot detach a replacement; terminal destruction prevents revival.

The host applies a snapshot's document height before acknowledging it for scroll
anchoring. Pending anchor adjustments survive further layout publications, while
new user scrolls take precedence. A resize audit exposed the need for this
explicit acknowledgement. The audit also found the demo's widget-update wrapper
forcing focus into the canvas input; updates now retain their native focus, with
an end-to-end regression check for continued checklist typing.

Validation: `pnpm run check` passes with 298 Vitest tests, one unchanged
collaboration TODO, and 42 end-to-end cases. Production build passes. Five new
controller tests run without React in all three browsers, covering coalescing,
callback freshness, caret/viewport geometry, measurement batching, deferred
anchoring, live scrolls, background progress and detach/remount/destruction.
`check:editor-reflow` passes Chromium, Firefox and WebKit for 2,000 and 10,000
blocks, plus concurrent streaming, comparing final geometry with an independent
eager reference. Its report is
`artifacts/public-interface-m4/layout-controller/reflow.json`.

Three serial production trials in
`artifacts/public-interface-m4/layout-controller/baseline.json` pass every unchanged
budget. Worst results: first usable 183 ms; streaming 1,097.1 ms; paste handler
56.9 ms; paste to paint 120.0 ms; typing 32.3 ms; paging 32.6 ms; loaded JS heap
28,945,532 bytes. The report identifies `043b1db` and measures this checkpoint's
uncommitted tree. An earlier adapter-only version exceeded the paste-to-paint
budget; controller-owned coalescing and paint-first scheduling removed that
regression without changing the limits.

Milestone 4 remains in progress. Complete viewport/DOM-overlay ownership, asset
readiness and cancellation, browser-extension composition and the public vanilla
mount are still required before its architecture judge and acceptance.
