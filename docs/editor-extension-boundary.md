# Core engines and schema extensions

The editing core no longer imports the editor demo's document model. Applications register a schema explicitly. A node's editable-text capability, not the name `paragraph`, determines which operations it supports.

```ts
import { createSchema } from './model';
import { createEditor } from './state';
import { starterDefinitions } from './extensions/starter-definitions';

const schema = createSchema({ extensions: starterDefinitions });
const editor = createEditor(schema, initialNodes, initialSelection);
```

These are public source entry points, not published packages or stable versioned interfaces yet. The demo starter kit registers paragraphs, headings, images, tables, quotes and lists. It is an application configuration, not a mandatory core schema or a complete rich-text starter kit.

## Ownership

| Layer                             | Owns                                                                                           | Does not decide                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Model, `src/model`                | Document structure, schemas, marks, codecs and durable-reference values                        | Session history, rendering or concrete node kinds               |
| Transform, `src/transform`        | Document operations, inversion and change maps                                                 | Selection publication, permissions or history grouping          |
| State, `src/state`                | Revision publication, selections, permissions, local history and retained reference resolution | Paragraph, heading, list, mention or comment semantics          |
| Node extensions                   | Attribute validators, storage fields, child constraints and content policies                   | History ordering or revision advancement                        |
| Inline-object API                 | Atomic inline positions, slicing, replacement and text projection                              | Whether an object is a mention, formula, emoji or another token |
| Annotation API                    | Range mapping/slicing/joining with extension-selected policies                                 | Comment replies, permissions, rendering or storage              |
| React adapter, `src/editor-react` | Registration and cleanup of canvas painting components                                         | Document schema or editing rules                                |
| Demo views and layout adapter     | React controls, overlays, style projection, measured layout inputs                             | Transaction atomicity or anchor resolution                      |

The low-level layout engine's use of the word paragraph means a text-layout unit. It does not require a document node called `paragraph`. Schema nodes must project their content and formatting into layout inputs. The existing demo adapter still explicitly projects its own paragraph nodes; it is not a general renderer for arbitrary schemas.

## Node extension API

`defineNode` creates a reusable named definition with a positive persistence
version, options, dependencies and a schema factory. Its schema declares an
attribute validator and text, atomic or container content. Text declarations name
the text field and optional mark/inline fields; container declarations name the
child field, depth and allowed names or groups.

`createSchema({ extensions })` compiles these declarations into one runtime schema.
It implements synchronous Standard Schema validation and infers content from the
installed definition tuple. The same assembly owns mark/inline registries and
versioned document codecs. `defineMark` and `defineInline` share configuration and
attribute validation conventions. Definitions and their options are reusable;
validated documents have immutable ownership.

The core generates text replacement, splitting, joining and child traversal. It
checks grapheme boundaries, identity preservation and text conservation. Unknown
node kinds, duplicate extension names and missing dependencies are errors.
Attribute validators can normalize imports, but cannot alter edited text in a way
that invalidates position mappings. Async attribute validators are rejected by
the synchronous boundary. Explicit node IDs and keys are retained; missing
identities are assigned during validation.

Concrete node types are inferred from definitions, including custom storage field
names. Names and versions do not imply cross-client convergence or migrations.
The table extension owns its existing wire payload adapter while generic codecs
retain ownership of identities and child traversal.

Commands currently compose imperative operations and transaction metadata.
Reusable behavior contributions and the named session command registry are the
next steps in the [public interface plan](public-interface-implementation-plan.md).
Executable callbacks are not stored in document content or transactions.

## Mentions and comments use public APIs

`src/extensions/mention.ts` implements a mention as `InlineObject<MentionData>`. Its extension supplies plain text and layout projection. The editing model stores extension data separately from positioned draw rectangles. The core inline helpers never inspect a person's name, mention label or identity provider.

`src/extensions/comment.ts` keeps discussion messages outside document nodes and captures independent `DocumentRange` values through state. It supplies range decorations without teaching the generic model about replies or comment storage. The model's annotation helpers remain available for other extension-owned ranges.

The browser `mentionView`, `underlineView`, `commentView` and `searchView`
extensions draw through the mounted view's geometry and drawing interface. Native
text descendants receive composed decorations through the same owner. The mount
owns their DOM hits and cleanup. React providers such as the demo's team context
remain application concerns; the old graphics-handle-based canvas adapter is removed.

The demo stores comments separately from document nodes and resolves their durable ranges through the public decoration API. Text and whole-block comments use the same position checkpoint. Backend discussion persistence remains an application responsibility.

## Alternatives considered

Keeping a fixed `StarterNode` union in the core would make each new schema require changes to history and anchors. That coupling has been removed.

Replacing every document with a new universal tree representation would address nested structures immediately, but would also commit persistence and operation formats before proving the extension contract. This pass instead uses an explicit schema capability interface and migrates the existing consumers. It does not retain a parallel legacy transaction API.

## Remaining structural work

Generic containers and structural operations now support inserting, replacing, removing, moving, wrapping and unwrapping children. A headless list extension owns content rules, numbering, indentation and Enter/Backspace commands. See [containers and lists](editor-containers-and-lists.md). The core does not branch on list node names.

The [selection contract](editor-selections.md) now supports text, node, all-document and custom selection types, with a headless cell-selection extension representing disjoint cells independently of tree order. Nested rendering, list toolbar actions, configurable marks and versioned codecs are implemented. A composed command registry, complete view lifetime and production package interfaces are tracked in the public interface plan. Automatic schema migrations remain separate work.

OT or CRDT integration must validate that peers agree on schemas and operation meanings. Schema names and versions alone do not establish convergence. Extensions will need declared structural semantics and deterministic conflict rules; core transactions remain local and revision-checked.

## Verification

`pnpm run check:editor-boundaries` rejects imports from the editing core into demo/schema/React/layout code. It enforces model → transform → state dependency direction, with lower modules independent of higher ones. Independent extension fixtures and cross-module consumers must use public entry points.

`pnpm run check:transactions` runs a separate heading/card schema without paragraphs, including a different text field, split/join, undo/redo and durable anchors. It tests diagnostics and formula tokens against the same public annotation and inline APIs used by comments and mentions. Invalid registration and a plugin that violates replacement semantics are rejected.

The existing editor, large-document and viewport-reflow checks exercise the migrated demo in Chromium, Firefox and WebKit. Extension dispatch occurs at document operations and layout projection, not per glyph. The Standard Schema contract is type-only; assembly reuses the existing validator dependency and adds no serialization boundary.
