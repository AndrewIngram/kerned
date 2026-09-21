# Implemented editor session APIs

The composed session interface is exported from `src/core/index.ts`. The lower-level
transaction, selection and history implementation is exported from
`src/state/index.ts`. Schema, content and durable-reference codecs live in
`src/model/index.ts`; document operations and mappings live in
`src/transform/index.ts`. These modules are headless. The
[implementation plan](public-interface-implementation-plan.md) distinguishes
shipped interfaces from the remaining view, lifecycle and package work.

## Composed sessions and reusable extensions

Assemble definitions once and pass the resulting schema to the session. Nodes,
marks, inline objects and behavior extensions may contribute commands and queries
through `setup`. Each session runs its own factories. Configuration belongs to
the definition; transactional state belongs to registered fields.

```ts
import { createEditor, defineCommand, defineExtension } from './src/core';
import { createSchema, indexTree } from './src/model';
import { paragraph } from './src/extensions/starter-definitions';
import { localHistory } from './src/extensions/history';

const Append = defineExtension({
  name: 'append',
  options: {},
  setup: () => ({
    commands: {
      appendText: defineCommand({
        execute(context, id: number, text: string) {
          const { schema, state } = context;
          const node = indexTree(schema, state.nodes).byId.get(id)?.node;
          const value = node ? schema.text(node) : null;
          if (value === null) return false;
          context.step({ kind: 'replaceText', id, from: value.length, to: value.length, text });
          return true;
        },
      }),
    },
  }),
});

const schema = createSchema({ extensions: [paragraph, Append, localHistory] });
const editor = createEditor({
  schema,
  content: [{ kind: 'paragraph', id: 1, text: 'Draft' }],
});

editor.can().appendText(1, '!');
editor.chain().appendText(1, '!').appendText(1, '?').run();
```

`defineCommand` contextually types a reusable command against the document in
which it executes. It does not capture a fixed node union. The installed name and
argument tuple determine `commands`, `chain`, `can` and `getCommandState` types.
`defineQuery` does the same for read callbacks. It defines a pure document query:
results for unchanged immutable state snapshots and primitive arguments are
reused. Treat returned objects as immutable snapshots. Each snapshot keeps a
bounded argument cache; object/function arguments bypass caching because callers
can mutate them. Selection, stored marks and document changes create new state
snapshots and invalidate those results. Ordinary contributed query functions
remain uncached and can be used for external state with its own subscriptions.
Queries and activity checks
receive `{ schema, state }`; commands additionally receive draft operations.
Query return values retain their inferred types.

Setup factories must install stable command and query names and signatures.
Conditional namespaces or optional members are rejected when constructing a typed
session. Keep the command installed and return `false` when unavailable; callers
can use `can()` without first checking whether a method exists. Tuple assemblies
infer installed methods. Variable-length extension arrays retain runtime
registration but do not promise named methods in the static session interface.

`editor.schema` retains the assembly's typed node, mark and inline factories.
Constructing values through the session checks installed names and required
attributes just as it does through the original schema.

`content` is import input and applies schema defaults and normalization.
`document` accepts canonical content, preserving existing identities and checking
normalized attributes without replaying import transforms. Both construction
paths validate once at the session boundary.

The complete starter kit composes with foreign text and atom definitions,
including node-valued update and paste arguments. Browser codecs and renderer
projection remain tied to starter definitions and still need their complete
migration. Native typing, Enter, deletion, plain/rich paste and table text edits
invoke named session commands; the browser adapter does not construct document
steps for these actions.

Ordinary reusable commands use `defineCommand`. If arguments contain canonical
nodes, use `defineDocumentCommand` to bind those arguments to the consuming
schema, without naming its node union:

```ts
export interface UpdateArguments extends DocumentCommandArguments {
  readonly args: [node: this['node']];
}

const update = defineDocumentCommand<UpdateArguments>({
  execute(context, node) {
    context.step({ kind: 'updateBlock', node });
    return true;
  },
});
```

`this['node']` is the assembled document node type. It can appear in arrays or
nested argument records, such as a clipboard fragment. Export argument interfaces
used by exported extension definitions so TypeScript can name them in declarations.
Named calls, chains, dry runs and activity queries all use the same bound tuple.
The binding is type-only; it adds no runtime parser or serialization. Callback
bodies still have to work for every consuming schema, using its operations and
node bindings. Closed-schema callbacks retain their construction-time rejection
when combined with incompatible foreign nodes.

`schema.node(definition)` binds construction and attribute reads to the installed
configuration of that definition:

```ts
const headings = schema.node(heading);
const node = headings.create(identity, { text: 'Introduction', level: 2 });
const attrs = headings.read(node); // Typed canonical attributes, or null for another node type.
```

The binding recognizes configured variants of the same definition and rejects an
unrelated definition that reuses its name. Constructor attributes use the
validator's input type; reads use its output type. Construction applies defaults
and normalization, owns attribute data and the child sequence, and validates
identity. Child placement and document-wide identity constraints are checked
when the command draft inserts the node. Container constructors accept children
as their third argument; text constructors initialize empty marks and inline
objects. Reads use canonical nodes and do not re-run validators.

Reusable commands obtain bindings through `context.schema` and identities through
`context.allocate()`. Heading changes preserve existing text, marks, inline
objects and durable positions through the target's editing policy. Lists, quotes
and tables retain foreign descendants through the executing schema's child
operations. `queries.selectedTable()` returns the selected table's `{ id, key }`
or `null`, without requiring a renderer projection.

`schema.copy(node, allocate)` copies a canonical subtree using its declared child
and inline storage. The allocator supplies new node identities; inline objects
receive fresh IDs. Copying retains canonical attributes, formatting and locks
without importing or normalizing them again. Paste uses this operation rather
than assuming field names or serializing content through a codec.

The internal `createStarterKitInput` adapter owns native editing commands and
returns browser event handlers plus table input handlers. Hosts supply feedback
and navigation callbacks, not implementations of typing, deletion, history or
paste. Handlers read the current session state, so selection changes do not
require a React render to update their target. A rejected edit restores the
hidden capture to canonical text before another input event.

## Commands

```ts
const append: Command<MyNode, [number, string]> = (context, id, text) => {
  const node = indexTree(schema, context.state.nodes).byId.get(id)?.node;
  if (!node) return false;
  const value = schema.text(node);
  if (value === null) return false;
  context.step({ kind: 'replaceText', id, from: value.length, to: value.length, text });
  return true;
};

editor.transact((context) => {
  if (!context.command(append, paragraphId, '!')) return false;
  return context.command(append, paragraphId, '?');
});
```

Each command reads the draft produced by preceding commands. `run()` publishes one transaction, one revision, one notification and, when history is installed, one undo event. Returning false abandons the entire chain. Capability checks run against a draft and do not publish, allocate editor IDs or change history/position metadata. Commands themselves must be pure apart from their draft operations; the engine cannot undo arbitrary external side effects in application callbacks.

An intervening editor change invalidates a prepared chain. Current permissions are checked again at execution, including after revocation. Permission failures return false. Invalid schema operations still throw rather than being hidden as ordinary command unavailability. The imperative `dispatch` API remains available and rejects unauthorized transactions before publishing any state.

The demo routes formatting and structural toolbar actions through command chains. Command definitions pair `execute` with an optional `activity({ schema, state })` query. `editor.getCommandState('installedCommand', ...args)` returns `{available, activity}`, with activity `active`, `inactive` or `mixed`. Imperative `context.command` accepts functions or definitions. `context.effect(callback)` defers view effects such as focus/scroll until a successful commit; `can()`, failed commands, permission rejection and stale chains do not run them. Effect exceptions are reported asynchronously after commit. Commands and extension reducers must be pure apart from draft operations and queued effects.

`toggleMarkCommand(schema, mark)` handles ranges and caret stored marks. `markActivity` distinguishes partial coverage within one text node as well as mixed blocks. `context.storedMarks(marks)` participates in validation and atomic publication. A standalone caret-only mark command retains the existing no-revision/no-history behavior. The demo formatting buttons use this command and report mixed coverage through `aria-pressed`.

`context.apply({ steps, selection, storedMarks })` applies content and its resulting
selection/marks in one draft transition. Use it when an operation returns both
steps and a selection, such as paste, rather than previewing those separately.
Extension fields see the complete transition, and subsequent commands see its
result. `step`, `steps`, `select` and `storedMarks` use the same implementation.

`context.steps(steps)` previews a batch together and commits it with the rest of the chain as one transaction. Prefer it for a command that already produces many steps; repeated `step` calls each create a separate draft preview.

`editor.chain(options)`, `editor.can().chain(options)` and
`editor.transact(command, options)` accept `{ history, time }`. History defaults
to separate undo entries. Use `{ history: { group: 'typing:node-key' }, time }`
for adjacent input events; ordinary groups coalesce within 750ms when the
selection is continuous. `time` defaults to `Date.now()` and is captured once
for the entire chain, including all preview reducers.

For native input, use `context.apply({ steps, selection, input: true })` with the
resulting caret selection. It captures marks from the current draft and records
them on each text operation, preserving formatting changes between insertions in
one chain and when replaying the published transaction. Explicit step marks
win over inherited marks. Plain text nodes without mark support accept unmarked
input; unsupported explicit marks reject the entire edit. The resulting caret
retains the insertion marks for subsequent typing.

Starter native-edit commands are available without a browser:

- `insertText(text, range?)` replaces the current text selection. An optional
  `{ from, to }` describes a native input diff within the current text node.
- `replaceText({ id, from, to, text, caret? })` targets a text node explicitly.
  Moving to a different target clears unrelated stored marks; an optional caret
  captures the native control's resulting selection.
- `pasteText(text)` inserts newline-separated paragraphs at the current selection,
  including within a table cell.
- `splitBlock()`, `deleteBackward()` and `deleteForward()` apply schema-owned text
  editing and starter list/quote policies. Deletion respects grapheme boundaries
  and does not merge separate table cells. Empty quotes unwrap; Enter in a list
  creates an item or outdents an empty one.

These commands observe the current draft, enforce permissions, participate in
atomic chains and use the same history options as formatting commands. Browser
input handlers retain normalization, event routing and composition grouping.

## View effects and ownership

Every composed session includes `focus()` and `scrollIntoView()` commands:

```ts
editor.chain().focus().toggleFormat('bold').scrollIntoView().run();
```

Effects run after successful publication, in command order. Reveal receives the
final selection after all draft edits. Dry runs, rejected commands and stale
chains do not invoke the view. Without a view, both commands succeed as no-ops,
so shared editing code can also run headlessly. An effect-only chain does not
create a transaction or history entry.

A session permits one mounted view. The adapter connects through
`connectEditorView(editor, { focus, reveal, destroy })`; the returned detach
function is idempotent and does not destroy the session. Duplicate attachments
are rejected. A queued effect captures the existing attachment and is discarded
if that view is detached before execution. It never transfers to a replacement
view, including one mounted after a headless request was queued.

Destroying the session destroys its attached view once, before application
`destroy` listeners. Unmounting a view leaves the borrowed session alive and
permits a later mount. Extensions cannot replace the session-owned `focus` and
`scrollIntoView` command names.

`mountEditorView` accepts `session`, `focusSelection` and `revealSelection`
bindings. It releases native event listeners on session destruction, cleans up
listeners after a rejected duplicate mount, and rejects changes to the session
of an already-mounted view. Callback updates within the same attachment are
supported. The React host remounts when its session changes and skips updates
to destroyed views. The React demo supplies those bindings; toolbar focus no longer needs
a demo callback. Its canvas adapter schedules reveal even when selection and
content are unchanged. Complete layout/graphics lifetime ownership remains
milestone 4 work.

## Observation and React

```ts
const unsubscribe = editor.subscribe(() => render(editor.state));
unsubscribe();
```

Use `editor.on(name, listener)` for typed semantic notifications:

| Event         | Published for                                                               |
| ------------- | --------------------------------------------------------------------------- |
| `update`      | Every published state transition, including stored marks.                   |
| `transaction` | Dispatch, undo and redo, with the before/after mapping.                     |
| `content`     | Those transactions that replace document content; suitable for persistence. |
| `selection`   | Any transition that changes the selection, including mapping through edits. |
| `destroy`     | Terminal session disposal, with the final snapshot.                         |

All channels return an idempotent unsubscribe function. Publication order is
`update`, `transaction`, `content`, `selection`, then `subscribe` callbacks for
view invalidation. Channels that do not apply are skipped. All listener lists
are captured before the first callback, so adding or removing listeners affects
the next publication. Dry runs and rejected edits publish nothing.

Callbacks observe the committed state. Mutation and destruction during
publication are rejected; schedule a later edit instead. Listener exceptions are
reported asynchronously without interrupting other notifications or turning an
already-published transaction into an apparent failed transaction. No React
import is present in core. Snapshot fields and their root node arrays are readonly
in TypeScript. Canonical nodes inferred from the assembled schema are also
readonly. Consumers must treat snapshots as immutable values and make edits
through commands or transactions. Unchanged nodes retain their identity; ordinary
edits do not deep-copy or recursively freeze the document. Custom imperative
schemas remain responsible for immutable node values.

`editor.destroy()` is idempotent and sets `isDestroyed` before invoking destroy
listeners. It clears subscriptions, history and the revision journal. The final
state, queries and durable-position reads remain available for inspection.
Edits, new subscriptions, undo/redo, dry runs and previously prepared chains
throw after destruction. Destroying one session does not affect another session
created from the same schema. Session destruction and view unmounting are separate; an attached view releases
its native listeners on session destruction. Complete graphics/layout resource
ownership remains milestone 4 work.

```tsx
import { useEditorState } from './src/editor-react';

function Revision({ editor }) {
  const revision = useEditorState(editor, (state) => state.revision);
  return <span>{revision}</span>;
}
```

The hook uses React's external-store contract and cleans up on unmount. `useEditorState(editor, selector, equal = Object.is)` caches the selected value and suppresses renders when it is unchanged. Selectors must be pure; use a stable selector for expensive calculations. `useCommandState(editor, definition, ...args)` observes availability and activity with value equality. Existing canvas primitives and DOM overlays continue to work.

## External comments and decorations

A comment thread stores its own discussion ID, messages and a `DocumentRange`. Its ID identifies the discussion, not a range registered in the document. Persist thread records wherever the application stores discussions.

```ts
const range = editor.positions.captureRange(editor.state.selection);
if (range) {
  const thread = { id: 'discussion-17', messages: ['Keep this wording'], range };
  const { resolved, unresolved } = resolveRangeDecorations(
    commentDecorations([thread]),
    editor.positions,
  );
}
```

`captureRange` accepts nonempty text, node, contiguous mixed and all-document selections. It normalizes backwards selections. Empty selections and extension-defined selections such as rectangular cells return `null`; a rectangle is not a contiguous document interval. Callers can capture a constructed selection without changing editor selection state.

`parseDocumentRange` validates JSON at the persistence boundary. Each endpoint stores a stable node key, document ID, capture revision and association, plus a text offset or node side. References contain no runtime IDs, range IDs, registered handles or list of covered nodes. Existing serialized `RelativeRange` values remain accepted. `resolveDocumentRange` returns ordered text slices and whole-node fragments, or an explicit `deleted`/`unavailable` result. `resolveRange` remains the text-only projection API.

Text insertion strictly inside a range expands it. Capture excludes insertion exactly at either text edge. Whole-node references follow moves, wrapping and unwrapping. Node edges follow splits and joins. When an endpoint is deleted, the range shrinks toward its surviving content, including atomic nodes. Deleting all covered content reports `deleted`; undo can resolve the original reference again. Moving endpoints into reversed document order reports `deleted` rather than including unrelated content between them.

The document position checkpoint now also retains surviving structural neighbours at deletion boundaries. Save it with the document ID, revision and stable node keys as before. The checkpoint stores edit metadata independent of the number of comments. Reloading can assign different runtime IDs. Older checkpoints remain readable, but structural deletion information absent from those checkpoints cannot be reconstructed.

`CommentThread` and `commentDecorations` come from `src/extensions/comment.ts`; the generic decoration resolver is in core. Whole-container fragments remain structural until a renderer projects them into its visual blocks. Unresolved decorations retain their reason and do not remove external discussion records. The demo projects comments into text highlights and whole-block outlines, and opens the existing reply panel for images too.

`captureComment(editor, id, messages)` uses the public range API. `createCommentStore(initial)` supplies a stable snapshot and subscription, plus `put`, `putAll` and `remove`; it can be observed with the optional React hook. Editing discussion messages does not change document revision or text undo history. The demo's discussion store is in memory; durable storage remains the application's responsibility.

These references resolve against the editor's accepted revision order. They do not implement concurrent operation transformation or establish OT convergence. The existing concurrent split/insert test remains skipped pending that work.

## Access and projection

Pass `permissions: {access(node), rootEditable?}` to `createEditor`. `access` returns `editable`, `read-only` or `protected` for the authenticated principal captured by the policy. Descendants inherit restrictions. `rootEditable` controls changes to the root child sequence; it does not by itself make every descendant read-only.

Text/property changes require edit access. Join, split and text-range operations also require access to their source text, so deletion of a protected source cannot launder that text into an editable node. Undoing a split performs the same source check. Child-sequence changes require edit access to the parent. Whole-node moves/deletes do not require editing the moved/deleted node, unless deletion encounters a locked descendant without edit access. Removing an ancestor cannot bypass that lock. Undo and redo use current access, not historical access. General node metadata includes `locked?: boolean`.

Use `projectDocument(schema, canonicalNodes, policy)` **at the trusted authority**. A protected subtree becomes `{kind: 'protected', key, locked}`. A visible container has childless node data plus separately projected children. Applications must avoid duplicating hidden content in public ancestor metadata. Changes to opaque application property values are conservatively treated as edits.

This does not authorize shipping canonical snapshots and hiding them in the UI. Raw transactions, history, checkpoints, search and clipboard endpoints must also be protected by the future authority/transport layer. Mark-level permissions and a client-side projected-document editing adapter are not implemented.

## Optimistic text proposals

```ts
const prepared = prepareTextProposal(schema, editor, {
  range,
  expected: [{ key: paragraphKey, text: 'original wording' }],
  replacement: 'revised wording',
});
if (prepared.status === 'ready') {
  editor.dispatch({
    baseRevision: prepared.baseRevision,
    steps: prepared.steps,
    origin: 'local',
    history: 'separate',
    time: Date.now(),
  });
}
```

Resolution follows edits outside the target. Expected node keys and selected text are compared before preparing the replacement. Changed content, changed target partitioning, deletion and unavailable references reject explicitly. The checked revision prevents an intervening edit from being overwritten after preparation. Dispatch still enforces permissions and schema invariants.

These are text preconditions, not a guarantee that formatting or policy remained unchanged while an agent worked. Network decoding, request deduplication, general operation transforms and collaborative history remain separate work.

## Marks and document serialization

Text extensions can provide a mark-storage adapter, and node extensions can provide a versioned payload codec. See [marks and codecs](marks-and-codecs.md) for the implemented interfaces, validation rules and remaining work. These are independent of React and do not add serialization to the editing/layout path.

## Browser view and React host

`mountEditorView(element, options)` from `src/editor-browser` owns pointer selection, native input/key/composition/clipboard routing and focus events. `update(options)` changes callbacks without reinstalling listeners; `destroy()` releases them and cancels dragging. Embedded controls opt out of canvas hit testing. Input events are routed only from the configured capture textarea, so interactive overlays retain their native behavior. `createTextInput(schema, editor)` owns schema-independent textarea synchronization, diffing, composition and native Select All observation. Call `sync` after selection/text changes outside composition, route native input through `read`, and release the cleanup returned by `mount`. `observeEditorViewport` handles page scrolling with a sticky toolbar or an embedded scrollport and returns cleanup.

`Editor` from `src/editor-react` mounts this runtime around its children. The caller supplies `view.pointer`, optional `view.input`, and a renderer as children. The editor session belongs to the caller and survives React unmount/remount. Both demos use this host and the native runtime. Schema-specific commands and clipboard policy live in the starter-kit extensions. Generic canvas painting, viewport lifecycle, multiclick policy and navigation binding live in reusable adapters. The demo assembles these pieces; this is not a zero-configuration rich-text widget. See [app ownership](editor-app-architecture.md).

`Editor` from `src/editor-react` attaches the full native mount, while
`useEditorState` and `useViewState` subscribe to session and view snapshots.
The demo uses this interface. The small `createReactRenderers<Value>` registry
maps application names to components; it is not the planned node/mark/decoration
registration API. That integration remains milestone 6 work. Browser extension
contributions and drawing are described in [the mounted view reference](mounted-editor.md).

## History ownership

Composed sessions retain undo history only when an installed extension contributes
`history` options. `starterExtensions` includes `localHistory`. Custom assemblies
can add `localHistory.configure({ depth: 256, newGroupDelay: 750 })`, where depth
counts undo groups and the delay is milliseconds between grouped edits. An active
composition remains one group even when it exceeds that delay. Selection changes
and explicit history boundaries close a group.

Two extensions claiming history reject with both owner names before state
creation. The contribution is configuration for the state module's local history
implementation; it is not a callback for mutating history during publication.
Collaborative history and concurrent rebasing remain unimplemented. Each session
creates independent storage even when it shares an extension definition.

Without this capability, edits still publish and durable positions still map,
but `editor.history` stays empty and the local-history command names are absent. The lower
imperative state constructor keeps its default local history for direct users;
pass `{ history: null }` to disable it. Its `HistoryOptions` accepts the same
retention and grouping settings.

`localHistory` contributes `editor.commands.undo()` and `redo()` with matching
`can()`, `chain()` and `getCommandState()` forms. These prepare a replay, validate
current permissions and extension fields, then publish once when the chain runs.
Dry runs do not move stacks, map positions, publish events or execute view effects.
Permissions and extension fields are checked again at execution. The composed
session no longer exposes separate `editor.undo()` or `editor.redo()` methods;
the lower imperative state session still exposes those operations.

A history replay occupies the chain's edit slot. It may accompany focus, reveal
or read-only commands, such as `editor.chain().focus().undo().run()`. Mixing a
replay with new content, selection or stored-mark changes, or another replay,
rejects the whole chain without publication. Invoke those as separate commands
when both actions are intended. A failed command after replay preparation also
abandons the replay. Following commands observe the prepared document, selection
and extension fields.

## Extension resource lifetime

Session factories receive `onDestroy` alongside `schema`. Register cleanup when
acquiring a resource, including before any subsequent setup that might throw.

```ts
const connection = defineExtension({
  name: 'connection',
  options: {},
  setup(_options, { onDestroy }: Pick<ExtensionContext<MyNode>, 'onDestroy'>) {
    const subscription = applicationUpdates.subscribe(handleUpdate);
    onDestroy(() => subscription.unsubscribe());
    return {};
  },
});
```

Each session owns its registrations. Destruction releases the attached view,
then extension resources in reverse registration order, then application destroy
listeners. Cleanup runs once. A registration made after disposal runs immediately,
which also covers a resource acquired by asynchronous work after the session ends.

Failed initialization releases resources from every factory that started,
including the factory that threw. Registry collisions and state-field
initialization errors follow the same path. All callbacks run even if one fails.
A setup failure plus cleanup failures produces an `AggregateError` retaining the
original setup error; cleanup errors during ordinary destruction use the
lifecycle event error reporting described above.

## Typed extension state

```ts
import { createEditor, defineExtension, defineQuery } from './src/core';
import { createSchema, type NodeIdentity } from './src/model';
import { createStateField } from './src/state';
import { paragraph } from './src/extensions/starter-definitions';

const Stats = defineExtension({
  name: 'stats',
  options: {},
  setup() {
    const count = createStateField<NodeIdentity, number>({
      create: () => 0,
      update: (value, event) => value + (event.kind === 'transaction' ? 1 : 0),
    });
    return {
      fields: [count],
      queries: { changeCount: defineQuery(({ state }) => count.read(state)) },
    };
  },
});

const schema = createSchema({ extensions: [paragraph, Stats] });
const editor = createEditor({ schema, content: [{ kind: 'paragraph', text: 'Draft' }] });
const count = editor.queries.changeCount();
```

State fields are independent of schema nodes and stored in weakly held session snapshots. Reducers receive before/after state and transaction or undo/redo mapping, or selection/stored-mark events. They prepare before publication; a thrown error leaves document, history and reference metadata unchanged. Readers notified after commit see updated fields. Reducers also run for draft command previews, must have no external effects, and cannot reenter editor mutation. A failed preview is never published. Fields do not automatically serialize, persist externally, or rewind on undo; their reducer defines the response to undo/redo.
