# Core engines and schema extensions

The editing core no longer imports the editor demo's document model. Applications register a schema explicitly. A node's editable-text capability, not the name `paragraph`, determines which operations it supports.

```ts
import { createSchema } from './model';
import { createEditor } from './state';
import { demoStarterKit } from './extensions/demo-schema';

const schema = createSchema(demoStarterKit);
const editor = createEditor(schema, initialNodes, initialSelection);
```

These are public source entry points, not published packages or stable versioned interfaces yet. The demo starter kit registers paragraphs, headings, checklists, images, tables, quotes and lists. It is an application configuration, not a mandatory core schema or a complete rich-text starter kit.

## Ownership

| Layer                             | Owns                                                                                           | Does not decide                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Model, `src/model`                | Document structure, schemas, marks, codecs and durable-reference values                        | Session history, rendering or concrete node kinds               |
| Transform, `src/transform`        | Document operations, inversion and change maps                                                 | Selection publication, permissions or history grouping          |
| State, `src/state`                | Revision publication, selections, permissions, local history and retained reference resolution | Paragraph, heading, list, mention or comment semantics          |
| Node extensions                   | Text access, replacement, split/join behavior, container contents, property-update rules       | History ordering or revision advancement                        |
| Inline-object API                 | Atomic inline positions, slicing, replacement and text projection                              | Whether an object is a mention, formula, emoji or another token |
| Annotation API                    | Range mapping/slicing/joining with extension-selected policies                                 | Comment replies, permissions, rendering or storage              |
| React adapter, `src/editor-react` | Registration and cleanup of canvas painting components                                         | Document schema or editing rules                                |
| Demo views and layout adapter     | React controls, overlays, style projection, measured layout inputs                             | Transaction atomicity or anchor resolution                      |

The low-level layout engine's use of the word paragraph means a text-layout unit. It does not require a document node called `paragraph`. Schema nodes must project their content and formatting into layout inputs. The existing demo adapter still explicitly projects its own paragraph nodes; it is not a general renderer for arbitrary schemas.

## Node extension API

`NodeExtension<N>` registers a unique name, a positive schema version, an acceptance predicate, property-update validation and one of three capabilities: editable text, an atomic block, or a container.

Text behavior supplies:

- `text(node)` to read the text independently of its storage field.
- `replace(node, from, to, text)` to update text and extension-owned data.
- `split(node, at, rightIdentity)` to produce two text blocks with the requested identities.
- `join(left, right)` to enforce compatible node types and combine their content.

The core checks grapheme boundaries, identity preservation and text conservation. An extension cannot silently return a different edit and leave position mappings incorrect. Registration rejects duplicate names and ambiguous or missing matches. Appending an unregistered node fails before publication.

Extensions may use a discriminated union of application nodes with whatever data they need. Core node identity requires only the local numeric handle and stable string key. Extension metadata is available as `schema.manifest`; saving and verifying that manifest is the future persistence adapter's responsibility. Registration versions do not currently implement schema migration or cross-client negotiation.

Commands should compose core operations and supply transaction metadata. A future command registry can expose names, keyboard bindings and enablement through the same public boundary. Arbitrary extension callbacks are not stored in document state or transactions.

## Mentions and comments use public APIs

`src/extensions/mention.ts` implements a mention as `InlineObject<MentionData>`. Its extension supplies plain text and layout projection. The editing model stores extension data separately from positioned draw rectangles. The core inline helpers never inspect a person's name, mention label or identity provider.

`src/extensions/comment.ts` keeps discussion messages outside document nodes and captures independent `DocumentRange` values through state. It supplies range decorations without teaching the generic model about replies or comment storage. The model's annotation helpers remain available for other extension-owned ranges.

`src/extensions/text-block-view.tsx` draws highlights and mention labels using public `CanvasPrimitive` registration from `src/editor-react`, with geometry and activation callbacks supplied by the host. It no longer imports the application's private rendering context. React providers such as the demo's team context remain application concerns.

The demo stores comments separately from document nodes and resolves their durable ranges through the public decoration API. Text and whole-block comments use the same position checkpoint. Backend discussion persistence remains an application responsibility.

## Alternatives considered

Keeping a fixed `StarterNode` union in the core would make each new schema require changes to history and anchors. That coupling has been removed.

Replacing every document with a new universal tree representation would address nested structures immediately, but would also commit persistence and operation formats before proving the extension contract. This pass instead uses an explicit schema capability interface and migrates the existing consumers. It does not retain a parallel legacy transaction API.

## Remaining structural work

Generic containers and structural operations now support inserting, replacing, removing, moving, wrapping and unwrapping children. A headless list extension owns content rules, numbering, indentation and Enter/Backspace commands. See [containers and lists](editor-containers-and-lists.md). The core does not branch on list node names.

The [selection contract](editor-selections.md) now supports text, node, all-document and custom selection types, with a headless cell-selection extension representing disjoint cells independently of tree order. A general nested renderer, list toolbar/keyboard wiring in the editor demo, configurable marks, a command registry, schema codecs/migrations and a production starter kit remain unfinished.

OT or CRDT integration must validate that peers agree on schemas and operation meanings. Schema names and versions alone do not establish convergence. Extensions will need declared structural semantics and deterministic conflict rules; core transactions remain local and revision-checked.

## Verification

`pnpm run check:editor-boundaries` rejects imports from the editing core into demo/schema/React/layout code. It enforces model → transform → state dependency direction, with lower modules independent of higher ones. Independent extension fixtures and cross-module consumers must use public entry points.

`pnpm run check:transactions` runs a separate heading/card schema without paragraphs, including a different text field, split/join, undo/redo and durable anchors. It tests diagnostics and formula tokens against the same public annotation and inline APIs used by comments and mentions. Invalid registration and a plugin that violates replacement semantics are rejected.

The existing editor, large-document and viewport-reflow checks exercise the migrated demo in Chromium, Firefox and WebKit. Extension dispatch occurs at document operations and layout projection, not per glyph. No new runtime dependency or serialization boundary was added.
