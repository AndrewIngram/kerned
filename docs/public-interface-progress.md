# Public interface implementation progress

This log records execution of the [implementation plan](public-interface-implementation-plan.md).
The [repository map](repository-map.md) remains the target decomposition; its
directories and interfaces are not evidence of completed extraction.

## Milestone status

| Milestone                           | Status    | Required outcome                                                               |
| ----------------------------------- | --------- | ------------------------------------------------------------------------------ |
| 0 — consumer contracts and baseline | Complete  | Source inventory, consumer scenarios, production measurements and quality gate |
| 1 — model, transform and state      | In review | Real ownership seams, acyclic imports and headless execution                   |
| 2 — typed schema assembly           | Pending   | Extension-derived content types and synchronous Standard Schema validation     |
| 3 — session commands and state      | Pending   | Shared named commands, draft chains, queries and per-session extension state   |
| 4 — complete view lifetime          | Pending   | Vanilla mounting owns rendering, input, assets and cleanup                     |
| 5 — presentation                    | Pending   | Per-view typography, fonts and appropriate cache invalidation                  |
| 6 — renderers and React             | Pending   | Public rendering/decorations and React adapters over the same view             |
| 7 — codecs and delayed edits        | Pending   | Extension codecs/input rules and durable async targets                         |
| 8 — workspace consumers             | Pending   | Built package exports, migrated demo and final performance verification        |

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
