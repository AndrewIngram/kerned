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
| 3 — session commands and state      | Pending  | Shared named commands, draft chains, queries and per-session extension state   |
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
