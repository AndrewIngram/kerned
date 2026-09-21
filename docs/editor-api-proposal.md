# Document model, editor API and extensions

Status: proposal, 2026-09-20. This document does not describe an implemented API. It recommends an owned model and runtime, informed by ProseMirror, Wordgard and Tiptap. It does not propose adding those editors as dependencies or moving layout into WebAssembly.

## Current position

The existing editing core already separates schema capabilities from named features. `src/editor/schema.ts` accepts application-owned text, atom and container types. Selection extensions include cell selection. Transactions provide change maps, and anchors have versioned serialization. Generic annotation and inline-object helpers also live in core.

The remaining coupling is largely in the demo and its assembly:

- `src/extensions/demo-model.ts` gives text blocks fixed formatting spans, mentions and comments.
- `src/extensions/demo-schema.ts` coordinates their split/join/edit behavior separately.
- `src/extensions/formatting.ts` understands a fixed set of styles rather than registered mark types.
- `src/demo/app/editor-workspace.tsx` assembles input, React state synchronization, commands and the view.
- `src/editor/transactions.ts` installs find directly and owns local history. It has no general extension-state or subscription contract.
- `src/editor-react/index.tsx` supplies canvas registration and pointer support, but not a standalone editor runtime with a React adapter.

The capability model was a deliberate way to avoid committing too early to a universal document representation. See [the existing boundary decision](editor-extension-boundary.md). Extensible marks, clipboard interoperability and collaboration now give us concrete reasons to revisit that choice.

## What to borrow

ProseMirror separates schema-defined nodes and marks from mapped view decorations. Its steps expose apply, invert, map and serialization operations. Those are useful contracts for an owned implementation. We should not adopt its DOM rendering assumptions. [Schema source](https://raw.githubusercontent.com/ProseMirror/prosemirror-model/master/src/schema.ts), [step source](https://raw.githubusercontent.com/ProseMirror/prosemirror-transform/master/src/step.ts), [decoration source](https://raw.githubusercontent.com/ProseMirror/prosemirror-view/master/src/decoration.ts)

Wordgard revisits the same design with reusable type objects, composable configuration, reducer state fields and separate view plugins. Its view receives transactions, giving it change information rather than only replacement snapshots. Its node values do not have occurrence identity. Wordgard still renders editable DOM; canvas projection remains our responsibility. See [the primary-source research](research-wordgard.md) and [Wordgard's comparison](https://wordgard.net/docs/prosemirror/).

Tiptap provides the desirable command ergonomics: direct commands, chains that share a transaction, and capability checks. Its React integration also offers state selectors. These are interaction contracts worth supporting independently of React. [Commands](https://tiptap.dev/docs/editor/api/commands), [React integration](https://tiptap.dev/docs/editor/getting-started/install/react)

## Representation alternatives

| Approach | Benefit | Cost |
| --- | --- | --- |
| Keep arbitrary application-shaped nodes and add adapters for marks, persistence and rendering | Least immediate migration; applications keep their storage shapes | Each schema must reconcile editing, clipboard and annotation semantics. Extensions cannot assume one inline representation. |
| Adopt one owned semantic node/mark model with extension-defined types | Shared editing and interoperability rules; extensions compose over the same content | Requires migration of existing schema, clipboard and projection code; must preserve measured performance. |

Recommend the second approach. The public model specifies content meaning and editing behavior, without requiring one JavaScript object per character or exposing the physical storage layout. Persistent trees, interned mark sets and packed layout buffers remain implementation choices that we can benchmark independently.

## Content and extension contracts

| Concept | Meaning | Examples |
| --- | --- | --- |
| Node | Structured document content, with a registered type and validated attributes | Text, paragraph, heading, list, table cell, image, inline mention |
| Mark | Persisted formatting or semantics attached to inline content | Bold, link, code, optional portable comment reference |
| Decoration | A view augmentation derived from document and extension state | Comment highlight, search result, diagnostic underline, remote cursor |
| Extension state | Feature-owned data with explicit update and persistence policy | Comment threads, search query, history, collaboration status |

Core understands text, inline/block placement, containers, atoms and generic editing capabilities. Paragraphs, headings, lists and tables come from extensions. A starter kit assembles a conventional schema and behavior. A text-layout paragraph remains an engine concept and does not require a schema node named paragraph.

Text-containing nodes expose inline content consisting of text runs and atomic inline nodes. Marks have registered names, attribute codecs, applicability rules, exclusion rules and endpoint behavior. Adjacent equivalent runs normalize. Stored marks define formatting for future typing at a collapsed selection. Extensions should not have to implement their own span slicing for every edit.

Type definitions should be reusable across schemas. Schema assembly assigns efficient runtime handles and validates relationships. Persisted documents use versioned names and attributes, never process-local numeric handles. Extension codecs define migrations and a policy for unknown types.

Common node metadata includes a general lock property, independent of schema type or any user's access state. Permission policy interprets the lock; it is not specific to read-only or protected nodes. See the collaboration and permissions proposal for deletion behavior.

Do not equate type interning or immutable object reuse with node occurrence identity. Stable keys need explicit rules for copy, paste, split, join and deletion. New pasted occurrences get new identities. Runtime numeric IDs can remain compact local handles.

## Comments as an extension

The default comment extension owns thread records and anchored ranges separately from document content. It maps those anchors through transactions and derives decorations. A canvas highlight and an optional React popover are renderers for that extension. No core node requires a `comments` property.

Overlapping threads must remain independently addressable. Deleting their text may leave an orphaned thread, remove its anchor, or delete the thread, according to an explicit extension policy. Copying text should not silently duplicate the original discussion. Undo policy for thread actions is separate from undoing text edits.

A product that needs comments to travel inside exported document content can install a comment-reference mark and a codec. The discussion data still belongs to the extension. Marks and decorations are both available; a transient highlight is not itself durable comment storage.

## Imperative core and command facade

The editor session owns immutable snapshots, dispatch, extension state, subscriptions and lifecycle. The view attaches separately. A mutable transaction builder provides a convenient way to construct an atomic update; published transactions and snapshots are immutable.

Proposed usage, with names subject to implementation review:

```ts
const editor = createEditor({
  document,
  extensions: [StarterKit, Comments.configure({ store: commentStore })],
});

editor.commands.toggleBold();
editor.chain().focus().toggleHeading({ level: 2 }).run();
editor.can().toggleBold();

editor.transact(tx => {
  tx.replaceText(range, "Replacement");
  tx.setSelection(tx.mapPosition(previousCaret));
});

const view = mountEditor(element, { editor, renderer });
// view.destroy() detaches the view; editor.destroy() ends the session.
```

Contracts to settle before implementing the facade:

- Commands operate on the evolving draft state. Each successful chain commits once and produces one history event. A declined chain discards its draft and scheduled effects.
- Capability checks execute the same planning rules without dispatch, focus, external writes or consuming committed IDs. They do not provide a weaker duplicate implementation of the command.
- Focus and scroll requests execute after successful commit. External asynchronous operations run outside the atomic document chain and may dispatch a later transaction.
- A transaction exposes operations, mapping, origin metadata and a change summary. Operations have explicit inversion and versioned codecs. Remote changes enter through the same validation boundary.
- Position APIs make their coordinate space clear. Original positions must be mapped before reuse after draft changes.
- Toolbar queries return applicability and active/inactive/mixed state. A command being available does not imply that it is currently active.
- Subscribers can select small state values with equality checks. Views receive change information alongside snapshots so they can invalidate affected content only.

The update order is plan, deterministic normalization, validation, atomic commit, publication, then view effects. Mapping of selection and anchors and reduction of extension state belong to the atomic update. Normalization must terminate and have coordinated ownership when collaborating. Avoid arbitrary reentrant dispatch from reducers.

## Extension composition

An extension can contribute schema types, commands, keymaps, state fields, decorations, codecs and view plugins. These are separate contracts packaged together for installation, rather than one object with unrestricted access to every stage.

Configuration contributions need a defined combination rule. Command handlers and keymaps need explicit precedence; duplicate type names and incompatible codecs should fail during assembly. State fields use deterministic reducers. View plugins own subscriptions and resources and dispose them on unmount. Headless extensions must not import browser or React code.

History, find, comments and collaboration should be optional extensions built on the same transaction APIs. Schema-specific navigation, list behavior and table selection remain extension contributions. Move existing functionality as each replacement is proven; do not retain two public implementations indefinitely.

## Browser view and React

The browser view owns input capture, composition, focus, geometry, pointer/keyboard interaction, clipboard integration and viewport management. It connects the editor session to our layout and paint pipeline. Those behaviors must work in a plain JavaScript mount.

The optional React package supplies an `Editor` component, lifecycle hooks, selector subscriptions and command-state hooks. React toolbars read the same command APIs as any other client. The existing canvas registration and DOM overlay work provide a starting point, not yet the complete adapter.

Custom node, mark and decoration renderers support two outputs:

- Canvas components describe measurement and painting through engine-owned contracts. Resolve them to reusable render descriptions; do not reconcile a React component for every glyph or caret movement.
- DOM components occupy positioned overlays for interactive controls. They declare measurement and event ownership, and the view preserves focus/composition when culling would otherwise remove them.

Mark and range-decoration renderers receive visible fragments because one range can span several lines and intersect other ranges. The engine retains ownership of editable text and hit testing. Arbitrary DOM components work as DOM overlays; turning them into canvas drawing is not automatic.

Declare whether a contribution changes metrics or paint only. A comment highlight must not trigger text shaping; a font-size mark must invalidate measurement. React elements, closures and DOM references do not enter document serialization or worker messages. Data-oriented layout and paint batches remain available without any React dependency.

## Relative positions and collaboration

Retain distinct text, node, all-content and extensible selections. Table cell selection can remain a set of structurally disjoint ranges. A generic node/mark model must not flatten that distinction.

Existing serialized anchors require a continuous revision-map journal. Stable block keys do not make character offsets survive arbitrary edits, journal compaction or concurrent changes. Define checkpoint/rebase behavior, affinity, deleted-position results and structural-gap references before promising durable cross-session positions.

Confirmed requirement: comment references remain valid for as long as their referenced range survives, and include new content inserted inside that range. This applies to old externally stored references after reload and compaction. The implementation must preserve the information needed to resolve them; expiring live ranges with the mapping journal is not acceptable. See the position proposal for endpoint deletion and range membership semantics.

Prepare operation mapping, inversion, codecs and origin metadata now. Treat collaboration convergence as a separate acceptance requirement. Wordgard's collaboration example uses a central authority and operational transformation, including coordinated structural corrections. Mapping positions alone does not implement OT. [Official collaboration example](https://wordgard.net/examples/collab/)

Do not select a transport or claim CRDT-compatible positions as part of this API proposal. Local history currently uses snapshot preconditions; remote rebasing needs deliberate work regardless of the chosen model.

## Suggested first implementation

Before the feature slice below, settle and test the position/range contract described in [positions and collaborative edits](editor-position-proposal.md). Marks, decorations and commands all depend on its behavior.

Implement a complete small path through the proposed boundaries: a generic text-containing node, extensible bold and link marks, and a comments extension that derives decorations from anchors. Provide the command facade and selector subscription needed to exercise them. Mount the same editor with plain JavaScript and with React.

Acceptance checks:

- A custom text node without paragraph semantics supports the same marks and commands.
- Comments require no comment-specific fields or imports in core or generic text nodes.
- Editing, clipboard round trips, undo/redo and mapped anchors preserve the expected marks and ranges.
- Chained commands commit once; unsuccessful chains and capability checks have no observable effects.
- Existing pointer, keyboard and cross-node selection behavior works through the shared browser view.
- Paint-only comment changes cause no shaping work. Compare typing, large paste, streaming load and retained memory with the current implementation.
- React unmount/remount does not destroy an externally owned editor session; selector subscriptions and view resources are released.

Then migrate the starter kit and table/list behavior through the proven contracts, deleting replaced adapters as callers move. Keep the existing layout engine and its performance checks throughout.
