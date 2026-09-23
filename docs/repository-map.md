# Repository map

The workspace packages and demo described below are implemented. The deeper
internal directory decomposition remains advisory. See the
[completion audit](public-interface-completion-audit.md) for verified responsibilities
and the [implementation plan](public-interface-implementation-plan.md) for tasks and gates.

## Current workspace

The root pins pnpm through `packageManager` and owns `pnpm-lock.yaml`.
`pnpm-workspace.yaml` discovers `packages/*` and `apps/*`. New internal package
dependencies use `workspace:*`. Do not add npm/yarn lockfiles or a second toolchain
inside a package. Packages remain private until distribution is explicitly ready.

Model, transform, state, core, view, React, standard document definitions, tables,
comments, history, outline extraction, search decorations, document editing and
starter-kit now live in workspace packages with built JavaScript and declaration
exports. Standard presentation defaults belong to the document and table packages.
The Vite React demo now lives in `apps/demo`, with its own declared dependencies,
HTML entries, assets and configuration. Root scripts delegate to that workspace.
Packages must own their implementation; do not create empty manifests
or exports pointing outside their package.

Development and tests select the `kerned-source` export condition for live source
updates. Production builds and ordinary Node consumers resolve `dist/` exports.
The build compiles dependencies first without bundling shared runtime classes.
`pnpm check` builds and checks consumers before starting the parallel suites;
tests never race replacement of the package build output.

## Target tree

```text
kerned/
├── package.json                 # Workspace-wide commands and development tools
├── pnpm-workspace.yaml
├── pnpm-lock.yaml                # Single dependency resolution record
├── .oxlintrc.json                # Shared lint rules, including vendored plugins
├── .oxfmtrc.json                 # Shared formatting policy, if configured
├── tsconfig.json                # Workspace typecheck entry point
├── vitest.config.ts             # Unit and real-browser test projects
├── playwright.config.js         # Isolated demo E2E server and browser matrix
├── packages/
│   ├── model/                   # @kerned/model: schema mechanics and document values
│   ├── transform/               # @kerned/transform: operations, inversion, mapping
│   ├── state/                   # @kerned/state: selections, publication, history
│   ├── core/                    # @kerned/core: session and extension composition
│   ├── view/                    # @kerned/view: native editing surface and lifetime
│   │   └── src/internal/        # Owned layout/shaping/painting; no public engine setup
│   ├── react/                   # @kerned/react: hooks, hosts, React renderer adapters
│   ├── starter-kit/             # @kerned/starter-kit: optional standard composition
│   ├── extension-document/      # Standard definitions, formatting, presentation and codecs
│   ├── extension-editing/       # Cross-node editing, structure, clipboard and native input
│   ├── extension-table/         # Table semantics, cell selection, commands, clipboard
│   ├── extension-comments/      # External threads/ranges and decoration contributions
│   ├── extension-history/       # Optional local undo/redo provider and commands
│   ├── extension-outline/       # Schema-independent cached heading extraction
│   ├── extension-search/        # Browser decorations for session search results
│   └── …                        # Other cohesive extensions as they are extracted
├── apps/
│   └── demo/                    # Vite React consumer of supported package exports
│       ├── src/                 # Toolbar, samples, outline UI and diagnostics
│       ├── public/              # Demo assets, books and generated engine assets
│       ├── editor.html
│       ├── extensions.html
│       └── vite.config.ts
├── tests/
│   ├── e2e/                     # Playwright user journeys across the assembled demo
│   ├── fixtures/                # Shared integration documents and browser fixtures
│   └── consumers/               # Built-package Node, vanilla and React consumers
├── scripts/                     # Ownership checks, asset setup, benchmarks, reports
├── tools/
│   └── oxlint/anti-slop/        # Existing vendored lint plugin; retain its setup
├── native-owned/                # Existing shaper source/build, not a second editor
├── artifacts/                   # Reproducible correctness and performance reports
└── docs/                        # Contracts, plans, research and measured results
```

Each package owns its manifest, supported exports and `src/`. Tests live beside
their implementation in `src/**/__tests__/`; cross-package integration tests may
remain in root `tests/`. Emit build output into each package's ignored `dist/`.
No package owns a separate lockfile. Do not split every internal helper into a
package: a package must provide an independent, coherent consumer contract.

Static codecs start with the relevant model/extension modules. Extract a distinct
static-rendering package only when its supported format adapters justify that
contract. Keep HTML/browser parsing out of headless import initialization.

## Illustrative package internals

The following is advisory decomposition. Names and file counts can change as
implementation reveals which responsibilities belong together. These are modules
inside packages, not additional packages or promised public subpath exports.
Keep tightly coupled implementation together; do not create every directory in
advance. Each `index.ts` exposes only the supported consumer contract.

The common manifest, build configuration and colocated `__tests__/` directories
are omitted below. Paths start at each package's `src/` directory.

```text
model/src/
├── index.ts                # Public document/schema values and construction
├── document/               # Nodes, marks, inline content, identity and fragments
├── schema/                 # Definitions, content rules, assembly and inferred types
├── validation/             # Standard Schema contract, issues, defaults and tree checks
├── positions/              # Snapshot coordinates and durable-reference value formats
└── codecs/                 # Structured document encoding, versions and codec contracts

transform/src/
├── index.ts                # Public operations and transformation results
├── steps/                  # Text, attribute and structural operation definitions
├── apply/                  # Pure operation application and affected-content validation
├── invert/                 # Inverse operations for previously applied changes
└── mapping/                # Position/identity change maps, composition and inversion

state/src/
├── index.ts                # Editor state, transaction and selection contracts
├── transactions/           # Atomic acceptance/publication and revision management
├── selection/              # Text/node/range/all selections and extension registration
├── fields/                 # Transactional extension state and update ordering
├── history/                # Undo grouping, redo and history-provider contract
├── references/             # Resolve/map durable values through history and checkpoints
└── permissions/            # Edit authorization and locked-node enforcement

core/src/
├── index.ts                # createEditor and extension-author entry points
├── editor/                 # Headless session construction, lifecycle and subscriptions
├── extensions/             # Configure/compose definitions, dependencies and capabilities
├── commands/               # Named registry, draft chains, dry runs and deferred effects
├── queries/                # Availability, active/mixed state and structural queries
└── events/                 # Typed content/selection/session events and disposal

view/src/
├── index.ts                # mountEditor, view configuration and geometry contracts
├── lifecycle/              # Readiness, mount/update/destroy and async cancellation
├── input/                  # Native events, hidden textarea, IME, clipboard and drop routing
├── interaction/            # Pointer selection, keyboard navigation and hit testing
├── viewport/               # Scroll ownership, reveal, anchoring and visible ranges
├── presentation/           # Theme resolution, fonts, metrics and invalidation classification
├── renderers/              # Node/mark contracts, content slots and DOM overlay lifetime
├── decorations/            # Contribution updates, visible fragments and widget lifetime
└── internal/               # Owned scene/layout/shaping/painting, caches and asset loading

react/src/
├── index.ts                # Hooks, hosts, context and React rendering registrations
├── editor/                 # useEditor, EditorContent and owned/borrowed session lifetime
├── subscriptions/          # Selector hooks and toolbar command/query subscriptions
├── context/                # Access to editor/view and preservation of host React context
└── renderers/              # React node/mark/widget adapters and canvas registrations

starter-kit/src/
├── index.ts                # Configurable kit composition; no privileged document union
├── defaults/               # Included extension set and configuration defaults
└── browser/                # Composition of those extensions' standard view contributions

extension-editing/src/
├── index.ts                # Default editing/structure commands and fragment operations
├── text-editing.ts          # Split, join, delete and replace across supported nodes
├── structure.ts             # Bind list/quote/heading operations to the caller's schema
├── clipboard-fragment.ts    # Closed rich fragments and fitted document insertion
└── browser.ts              # Native input, shortcut and clipboard policy contribution

extension-table/src/
├── index.ts                # Headless table definition and configuration
├── schema/                 # Table/row/cell attributes and valid content
├── grid/                   # Logical cell grid, spans and rectangular coordinates
├── selection/              # Cell selection and mapping through structural edits
├── commands/               # Row/column/cell edits, availability and navigation policy
├── clipboard/              # Rectangular fragments, paste fitting and rich cell content
├── codecs/                 # Semantic table import/export
└── browser/                # Default rendering, measurement and table interaction wiring

extension-comments/src/
├── index.ts                # Comment extension and application-store contract
├── threads/                # Thread/message values; application supplies persistence
├── ranges/                 # Capture/resolve comment targets through public reference APIs
├── commands/               # Comment actions and query contributions
└── browser/                # Highlights/widgets and activation via public decorations
```

For a smaller extension, `schema.ts`, `commands.ts` and `browser.ts` may be the
whole implementation. Paragraph, heading, list, blockquote and formatting rules
remain extension-owned even if several small definitions share a cohesive package.
Starter-kit imports and configures those definitions; it does not absorb their
implementations into a second schema system. Exact extension package granularity
is intentionally left advisory.

### How responsibilities connect

- **Schema versus composition:** model assembles document rules and the Standard
  Schema validator. Core composes executable extension contributions around that
  schema. Model never imports command implementations or renderer definitions.
- **Transforms versus transactions:** transform describes what changed and how
  positions map. State decides whether a transaction can publish, advances the
  revision, updates selection/fields and records history. Core makes those
  operations convenient through named commands.
- **Reference values versus resolution:** model owns serializable reference
  shapes; transform emits mappings; state resolves references and owns mapping
  retention. Comment threads store reference values without registering ranges
  in the document or depending on undo-stack lifetime.
- **Generic versus specialized selection:** state owns the selection extension
  contract. The table extension interprets grid adjacency; the view supplies
  pointer/keyboard geometry without defining table semantics.
- **Input versus editing policy:** view normalizes browser events and manages
  composition. Extensions supply applicable commands, rules and content codecs.
  A native event handler must not become another implementation of a command.
- **Presentation versus layout:** presentation resolves configurable styles once;
  private layout consumes metrics and font identities. Painting and interaction
  consume the same geometry. These calls remain in-process without a serialization
  boundary between directories.
- **Headless versus browser contributions:** extension browser entry points may
  import view contracts. Their headless entry points must not import browser
  implementations transitively. React adapts a view registration and does not
  become required by standard browser rendering.
- **Comments versus discussion UI:** the extension supplies ranges and decoration
  behavior. The demo or consuming application owns its sidebar, moderation,
  notification and persistence choices.

History-provider and permission-enforcement contracts belong to state, while
optional providers can later become separate extensions if independent use
justifies it. No remote permission calls occur inside pure transforms. Storage
projection must exclude unauthorized content before delivery; visual hiding in
view is not permission enforcement.

## Ownership by milestone

| Milestone | Repository change                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| 0         | Baseline artifacts and consumer scenarios; no source relocation required                                          |
| 1         | Extract model/transform/state responsibilities and enforce their imports                                          |
| 2         | Typed schema and extension definitions; real kit definitions replace demo schema assembly                         |
| 3         | Core session and extension-owned commands replace demo action assembly                                            |
| 4         | View owns browser input and private layout/rendering lifecycle                                                    |
| 5         | View configuration and extension defaults replace rigid typography constants                                      |
| 6         | React adapts the view; public renderer/decoration contributions support custom extensions                         |
| 7         | Codecs and input policies complete their supported extension contracts                                            |
| 8         | Finish package manifests/build exports, move the demo to apps/demo, validate built consumers, remove legacy paths |

Package manifests can arrive during milestones 1–7 as their implementations
become self-contained. Milestone 8 verifies the complete workspace distribution;
it is not permission to delay dependency checks until the end.

## Preserve the lint and test work

The root quality gate remains `pnpm check`. Preserve the existing commands for
lint, formatting, strict typechecking, project ownership checks, Vitest unit and
browser tests, and Playwright E2E. Keep `npm-run-all2` as the existing task runner;
its name does not mean the repository uses npm for package management.

Moving a module must update all of the following in the same change:

| Configuration                              | Migration obligation                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `.oxlintrc.json`                           | Keep all rules/plugins and narrow exceptions; apply to moved packages and apps without broad ignores                      |
| Formatter config                           | Keep existing policy and vendored/generated exclusions; include authored workspace files                                  |
| `tsconfig.json` and future package configs | Include package/app source and type fixtures; retain strictness and correct headless/browser environments                 |
| `vitest.config.ts`                         | Add package/app test roots before removing old roots; preserve unit versus browser separation and all browser instances   |
| `playwright.config.js`                     | Preserve isolated E2E mode, dedicated port, strictPort and no reuse of the user's demo server                             |
| `check-project.mjs`                        | Discover source and supported entry points across workspaces; keep orphan-source, missing-import and documentation checks |
| Import ownership checks                    | Cover package dependencies, exported entry points, type imports, re-exports and dynamic imports                           |
| Asset/build/benchmark scripts              | Resolve paths from their owner; do not assume a flat node_modules layout or root-hosted app                               |

Before and after each move, compare collected tests by project and preserve their
identity. A green run with fewer discovered tests is not success. Record renamed
tests explicitly. Do not merge browser tests into Node tests, restore old test
locations, change React compiler settings, weaken lint rules, replace existing
validation helpers, or reset test cleanup to make relocation easier.

When physical package extraction starts, extend the project checker to enumerate
workspace manifests and verify exports resolve, workspace dependencies exist,
and cross-package imports use those exports. Add a built-consumer test so source
aliases cannot hide invalid packaging. Workspace setup alone does not prove the
architectural seams are implemented.
