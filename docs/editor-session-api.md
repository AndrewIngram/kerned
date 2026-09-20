# Implemented editor session APIs

The APIs below are exported from `src/editor/index.ts`. They are headless; React is optional. They describe the current implementation, while [the broader API proposal](editor-api-proposal.md) includes work not yet implemented.

## Commands

```ts
const append: Command<MyNode, [number, string]> = (context, id, text) => {
  const node = indexTree(schema, context.state.nodes).byId.get(id)?.node;
  if (!node) return false;
  const value = schema.text(node);
  if (value === null) return false;
  context.step({kind: 'replaceText', id, from: value.length, to: value.length, text});
  return true;
};

const enabled = editor.can().command(append, paragraphId, '!').run();
editor.chain().command(append, paragraphId, '!').command(append, paragraphId, '?').run();
```

Each command reads the draft produced by preceding commands. `run()` publishes one transaction, one revision, one notification and one undo event. Returning false abandons the entire chain. Capability checks run against a draft and do not publish, allocate editor IDs or change history/position metadata. Commands themselves must be pure apart from their draft operations; the engine cannot undo arbitrary external side effects in application callbacks.

An intervening editor change invalidates a prepared chain. Current permissions are checked again at execution, including after revocation. Permission failures return false. Invalid schema operations still throw rather than being hidden as ordinary command unavailability. The imperative `dispatch` API remains available and rejects unauthorized transactions before publishing any state.

The demo routes formatting and structural toolbar actions through command chains. Command definitions pair `execute` with an optional `activity(state)` query. `editor.commandState(definition, ...args)` returns `{available, activity}`, with activity `active`, `inactive` or `mixed`. Chains accept functions or definitions. `context.effect(callback)` defers view effects such as focus/scroll until a successful commit; `can()`, failed commands, permission rejection and stale chains do not run them. Effect exceptions are reported asynchronously after commit. Commands and extension reducers must be pure apart from draft operations and queued effects.

`toggleMarkCommand(schema, mark)` handles ranges and caret stored marks. `markActivity` distinguishes partial coverage within one text node as well as mixed blocks. `chain.storedMarks(marks)` participates in validation and atomic publication. A standalone caret-only mark command retains the existing no-revision/no-history behavior. The demo formatting buttons use this command and report mixed coverage through `aria-pressed`.

`chain.steps(steps)` previews a batch together and commits it with the rest of the chain as one transaction. Prefer it for a command that already produces many steps; repeated `step` calls each create a separate draft preview.

## Observation and React

```ts
const unsubscribe = editor.subscribe(() => render(editor.state));
unsubscribe();
```

Dispatch, selection changes, undo and redo notify subscribers. No React import is present in core. Subscribers receive the current immutable-by-convention session snapshot. Listener exceptions are reported asynchronously after the successful commit; they do not turn an already-published transaction into an apparent failed transaction.

```tsx
import {useEditorState} from './src/editor-react';

function Revision({editor}) {
  const revision = useEditorState(editor, state => state.revision);
  return <span>{revision}</span>;
}
```

The hook uses React's external-store contract and cleans up on unmount. `useEditorState(editor, selector, equal = Object.is)` caches the selected value and suppresses renders when it is unchanged. Selectors must be pure; use a stable selector for expensive calculations. `useCommandState(editor, definition, ...args)` observes availability and activity with value equality. Existing canvas primitives and DOM overlays continue to work.

## External comments and decorations

A comment thread stores its own discussion ID, messages and a `RelativeRange`. Its ID identifies the discussion, not a range registered in the document. Persist thread records wherever the application stores discussions.

```ts
const thread: CommentThread<Message> = {
  id: discussionId,
  range: editor.positions.range(editor.positions.at(fromId, from, 1), editor.positions.at(toId, to, -1)),
  messages,
};
const {resolved, unresolved} = resolveDecorations(commentDecorations([thread]), editor.positions);
```

`CommentThread` and `commentDecorations` come from `src/extensions/comment.ts`; the generic decoration resolver is in core. Resolved decorations carry node-local text intervals for the renderer. Unresolved decorations retain the reason so the application can show an orphaned discussion or diagnose missing history. They are not silently removed from external storage. The demo uses this path for its highlights and reply panel; document nodes no longer have a comments field. `captureComment(schema, editor, id, messages)` captures a nonempty text or all-document selection. `createCommentStore(initial)` supplies a stable snapshot and subscription, plus `put`, `putAll` and `remove`; it can be observed with the optional React hook. Replacing a thread to edit its messages does not change document revision or text undo history. Discussion records still need application persistence; the demo store is in memory.

## Access and projection

Pass `permissions: {access(node), rootEditable?}` to `createEditor`. `access` returns `editable`, `read-only` or `protected` for the authenticated principal captured by the policy. Descendants inherit restrictions. `rootEditable` controls changes to the root child sequence; it does not by itself make every descendant read-only.

Text/property changes require edit access. Join, split and text-range operations also require access to their source text, so deletion of a protected source cannot launder that text into an editable node. Undoing a split performs the same source check. Child-sequence changes require edit access to the parent. Whole-node moves/deletes do not require editing the moved/deleted node, unless deletion encounters a locked descendant without edit access. Removing an ancestor cannot bypass that lock. Undo and redo use current access, not historical access. General node metadata includes `locked?: boolean`.

Use `projectDocument(schema, canonicalNodes, policy)` **at the trusted authority**. A protected subtree becomes `{kind: 'protected', key, locked}`. A visible container has childless node data plus separately projected children. Applications must avoid duplicating hidden content in public ancestor metadata. Changes to opaque application property values are conservatively treated as edits.

This does not authorize shipping canonical snapshots and hiding them in the UI. Raw transactions, history, checkpoints, search and clipboard endpoints must also be protected by the future authority/transport layer. Mark-level permissions and a client-side projected-document editing adapter are not implemented.

## Optimistic text proposals

```ts
const prepared = prepareTextProposal(schema, editor, {
  range,
  expected: [{key: paragraphKey, text: 'original wording'}],
  replacement: 'revised wording',
});
if (prepared.status === 'ready') {
  editor.dispatch({
    baseRevision: prepared.baseRevision, steps: prepared.steps,
    origin: 'local', history: 'separate', time: Date.now(),
  });
}
```

Resolution follows edits outside the target. Expected node keys and selected text are compared before preparing the replacement. Changed content, changed target partitioning, deletion and unavailable references reject explicitly. The checked revision prevents an intervening edit from being overwritten after preparation. Dispatch still enforces permissions and schema invariants.

These are text preconditions, not a guarantee that formatting or policy remained unchanged while an agent worked. Network decoding, request deduplication, general operation transforms and collaborative history remain separate work.

## Marks and document serialization

Text extensions can provide a mark-storage adapter, and node extensions can provide a versioned payload codec. See [marks and codecs](marks-and-codecs.md) for the implemented interfaces, validation rules and remaining work. These are independent of React and do not add serialization to the editing/layout path.

## Browser view and React host

`mountEditorView(element, options)` from `src/editor-browser` owns pointer selection, native input/key/composition/clipboard routing and focus events. `update(options)` changes callbacks without reinstalling listeners; `destroy()` releases them and cancels dragging. Embedded controls opt out of canvas hit testing. Input events are routed only from the configured capture textarea, so interactive overlays retain their native behavior. `createTextInput(schema, editor)` owns schema-independent textarea synchronization, diffing, composition and native Select All observation. Call `sync` after selection/text changes outside composition, route native input through `read`, and release the cleanup returned by `mount`. `observeEditorViewport` handles page scrolling with a sticky toolbar or an embedded scrollport and returns cleanup.

`Editor` from `src/editor-react` mounts this runtime around its children. The caller supplies `view.pointer`, optional `view.input`, and a renderer as children. The editor session belongs to the caller and survives React unmount/remount. Both demos use this host and the native runtime. Schema-specific shortcuts, clipboard codecs and CanvasKit scene assembly remain in the application; this is not a zero-configuration rich-text widget.

`createReactRenderers<Value>([{name, component}])` creates a typed `ExtensionView` taking `{type, value}`. Build registries outside render so components retain their identity. Components may return DOM, `CanvasPrimitive` registrations, or both. Duplicate names and missing registrations reject explicitly. The starter kit registers block renderers, a mention inline renderer, underline drawing, and external comment decorations through this public interface. Layout geometry is passed by the host; React is absent from core and from the browser runtime.

## Typed extension state

```ts
const stats = createStateField<MyNode, number>({
  create: () => 0,
  update: (count, event) => count + (event.kind === 'transaction' ? 1 : 0),
});
const editor = createEditor(schema, nodes, selection, [], {fields: [stats]});
const count = stats.read(editor.state);
```

State fields are independent of schema nodes and stored in weakly held session snapshots. Reducers receive before/after state and transaction or undo/redo mapping, or selection/stored-mark events. They prepare before publication; a thrown error leaves document, history and reference metadata unchanged. Readers notified after commit see updated fields. Reducers also run for draft command previews, must have no external effects, and cannot reenter editor mutation. A failed preview is never published. Fields do not automatically serialize, persist externally, or rewind on undo; their reducer defines the response to undo/redo.
