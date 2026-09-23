# Tiptap API audit

Reviewed 2026-09-21 against official Tiptap 3.x documentation. This is a design
audit across the major editor interface families, not an exhaustive compatibility
specification or a promise to implement every commercial feature. Findings from
documentation are distinguished from recommendations for Kerned below.

Companion research: [React, rendering, persistence, positions and collaboration](tiptap-adapters-research.md).
Target module ownership: [package architecture](package-architecture.md).

## Editor instance and lifecycle

Tiptap accepts content and extensions in one configuration object. It supports
mounting later, unmounting, destruction, editable state, content export, active
format queries and option updates. The instance assembles the underlying editor
machinery. [Editor instance](https://tiptap.dev/docs/editor/api/editor).

**Adopt:** one convenient editor session and a complete mounting interface.
Ordinary consumers never initialize fonts, CanvasKit, layout caches or a hidden
textarea. Unmounting a view must be distinct from destroying the document session.

**Adapt:** keep the session headless and place browser ownership in `view`.
Canvas/font loading needs explicit readiness and error handling. Destroy during
loading must cancel installation and release resources. Mutable caches belong to
one session/view, even when immutable font bytes can be shared.

Current gap: `demo/app/main.tsx`, `app.tsx` and `editor-workspace.tsx` coordinate
these internals; `editor-react/editor.tsx` mounts listeners rather than the whole
editing surface.

## Commands, chains and queries

Tiptap exposes extension commands through `editor.commands`, supports chains
combined into one transaction, and offers `can()` for dry runs. Nested commands
must use the supplied chain context. `first()` tries alternatives until one
succeeds. [Commands](https://tiptap.dev/docs/editor/api/commands).

**Adopt:** discoverable named commands, matching dry-run commands, atomic chains
and explicit fallback ordering. Toolbar, keyboard and programmatic edits should
invoke the same implementation. Content insertion/replacement, formatting,
structural edits and selection changes belong to recognizable command families.

**Retain stronger guarantees:** our dry-run context must suppress effects, and
failed chains must not publish partial edits. Preserve `active`, `inactive` and
`mixed` activity independently of availability. A boolean convenience query may
exist, but must not erase mixed selection information.

**Adapt:** focus and scroll are view effects queued after successful publication.
Document commands must work without a mounted view. Asynchronous uploads or agent
responses must resolve their target against current state before opening a new
transaction; do not hold a transaction open across network work.

Current gap: `editor/commands.ts` already has draft chains and deferred effects,
but `starter-kit/actions.ts` adds a parallel render-snapshot-dependent interface.
Build on the existing imperative core and migrate those actions into extensions.

## Extension composition and configuration

Tiptap extensions have names, configurable options, storage, commands, ordering
priority and hooks. Node and mark names identify schema content. Its TypeScript
examples use declaration augmentation for extension commands and storage.
[Extension interface](https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/extension).

**Adopt:** one extension registration composes its contributions. Configuration
produces a reusable definition; mutable state is allocated per editor. Distinguish
options, transactional state fields, ephemeral caches and persisted content.
Define deterministic precedence and diagnose duplicate names/commands or missing
dependencies at composition time.

**Adapt:** retain separate headless and view contracts internally. Consumers
should not reconcile schemas, selections, clipboard behavior and rendering by
hand. Do not assume a globally augmented TypeScript method proves its extension
was installed in a particular editor. Prefer inferred installed capabilities
where practical, with runtime capability checks for dynamic configurations.

Tiptap supports extending existing definitions and adding attributes, including
shared attributes across types.
[Extending extensions](https://tiptap.dev/docs/editor/extensions/custom-extensions/extend-existing).

**Adopt selectively:** support deliberate overrides and reusable configuration.
Avoid an inheritance system whose behavior depends on invisible parent calls.
Public extension contracts should be sufficient for third-party nodes, marks,
decorations and commands, including our own comments and mentions.

## Kits and concrete schemas

StarterKit bundles standard extensions and permits configuring or disabling
individual members. [Official StarterKit documentation source](https://raw.githubusercontent.com/ueberdosis/tiptap-docs/main/src/content/editor/extensions/functionality/starterkit.mdx).
TableKit similarly groups table, row, header and cell definitions.
[TableKit](https://tiptap.dev/docs/editor/extensions/functionality/table-kit).

**Adopt:** kits are optional composition, not privileged schemas. A consumer can
use the default kit, reduce it, or assemble different extensions. Disabling a
required dependency must produce a useful composition error. Table selection,
clipboard and commands must arrive with the table extension rather than through
extra demo wiring.

Current gap: starter-kit types and helpers import `demoSchema` and a concrete
`StarterNode` union. The generic session must remain usable with a foreign schema.

## Nodes and marks

The node interface describes allowed content/marks, grouping, inline or atomic
behavior, selection and structural isolation. It also supports attributes and
HTML parsing/serialization. [Node interface](https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/node).
The mark interface exposes attributes and policies such as inclusivity and
exclusion. [Mark interface](https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/mark).

**Adopt the capabilities:** core editing should ask what a node allows, not branch
on names such as paragraph or table cell. Isolation and atomicity are distinct;
a container need not be atomic, and an atomic view need not imply no stored
children. Mark endpoint behavior must be explicit and tested for insertion,
splitting, joining and paste.

**Do not copy unverified defaults:** the docs are design evidence, not our
behavioral specification. Resolve subtle mark semantics against source and tests
when implementing. Preserve node locking and permission checks as independent
policy; structural isolation is not authorization.

## Typography and styling

Tiptap separates editor behavior from application styling and allows HTML classes
and attributes. [Styling](https://tiptap.dev/docs/editor/getting-started/style-editor).
Its Heading extension configures allowed levels and supplies heading commands.
[Heading](https://tiptap.dev/docs/editor/extensions/nodes/heading).
TextStyleKit groups optional font, color and line-height features.
[TextStyleKit](https://tiptap.dev/docs/editor/extensions/functionality/text-style-kit).

**Adapt for canvas:** extension defaults plus consumer theme overrides resolve
into numeric metrics and registered font identities. CSS classes alone cannot
configure shaping. Canvas, DOM views and hit testing consume the same resolved
styles. Theme changes are view updates; author-applied font/size attributes are
document changes if the installed schema supports them. Neither should be
mistaken for zoom.

Tiptap's Typography extension performs input substitutions such as smart quotes
and ellipses. It is not a heading-scale or baseline-grid theme.
[Typography](https://tiptap.dev/docs/editor/extensions/functionality/typography).

Current gap: `extensions/typography.ts`, `extensions/starter-kit/presentation.ts`, table rendering and
CSS each impose presentation policy. The package plan records their consolidation.

## Events and subscriptions

Tiptap distinguishes content updates, selection updates, transactions, focus,
blur, creation and destruction, with configuration callbacks and event binding.
[Events](https://tiptap.dev/docs/editor/api/events).

**Adopt:** typed events with documented publication order and cleanup. A selection
change should not trigger document autosave. Document revision, selection state
and view readiness need distinct signals. Keep ordinary subscriptions cheap;
serializing the full document on every transaction is inappropriate for books.

Current gap: the core has a general subscription mechanism, while the demo
coordinates notices, focus and painting separately. Use selectors and changed
ranges/revision information instead of publishing a second mutable UI state store.

## Input, paste and asynchronous integration

Tiptap offers extension-owned input rules with matchers and attribute extraction,
including undoable transformations. Paste rules transform matched pasted text.
[Input rules](https://tiptap.dev/docs/editor/api/input-rules),
[paste rules](https://tiptap.dev/docs/editor/api/paste-rules).

**Adopt:** configurable rule registration and ordered event handling. Rules create
normal transactions, obey permissions and participate in undo. Keep clipboard
decoding, schema normalization and text-pattern rules separate. A rich rectangle
paste must not accidentally run through a destructive plain-text fallback.
IME composition must not be rewritten mid-composition by ordinary input rules.

FileHandler exposes file paste/drop callbacks rather than implementing uploads.
[FileHandler](https://tiptap.dev/docs/editor/extensions/functionality/filehandler).
The Suggestion utility separates query matching, asynchronous results and popup
rendering, with cancellation and lifecycle support.
[Suggestion](https://tiptap.dev/docs/editor/api/utilities/suggestion).

**Adopt:** application-owned uploads and data sources; editor-owned insertion
targets, event consumption and popup geometry. Use durable references for delayed
insertion and discard stale asynchronous results. Popup placement must work from
canvas geometry without requiring an underlying text DOM element.

## Prioritized implications for our refactor

| Priority | Deliverable                                | Proof through the consumer interface                                                       |
| -------- | ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 1        | Composed extensions and session commands   | Custom schema, omitted extension, command availability, mixed formatting and one-step undo |
| 1        | Complete view lifetime                     | Mount/unmount/remount, destruction during loading, two independent editors                 |
| 1        | Configurable presentation                  | Different themes side by side; metric reflow preserves caret and scroll                    |
| 2        | React adapter and custom rendering         | Selective subscriptions; node/mark/widget cleanup under virtualization                     |
| 2        | Typed events and codecs                    | Autosave ignores selection; rich content survives round trip without a mounted view        |
| 2        | Input and clipboard contribution contracts | Shortcut precedence, IME, paste fidelity, atomic permissions                               |
| 3        | Async suggestion/file helpers              | Cancelled requests and moving insertion targets                                            |

These priorities sequence the already-approved work; they are not an invitation
to rebuild the whole Tiptap catalog. Preserve our owned layout, durable references,
permissions and incremental document loading behind the simpler interface.

## Coverage and limits

Reviewed editor configuration/lifecycle, commands/queries, extensions and kits,
nodes/marks, events, typography/styles, input/paste rules and representative
asynchronous utilities. The companion audit covers React, custom rendering,
decorations, serialization, positions and collaboration. Commercial hosting,
billing, AI product endpoints, document conversion services and every individual
node's settings are outside this editor-interface audit. Failed documentation
fetches were retried through search or official documentation source; this is
not a tested compatibility claim for any particular installed Tiptap version.
