# React integration

Import hooks, content hosts and React rendering adapters from `@gprose/react`.
The package adapts the same session and view used by vanilla consumers. Custom
node, mark, inline and widget rendering is described in
[React extensions](react-extensions.md).

Create the schema outside rendering, then let a hook own the session:

```tsx
const schema = createSchema({ extensions: starterBrowserExtensions() });
const { EditorProvider, useCurrentEditor } = createEditorContext(schema);

function DocumentEditor() {
  const editor = useEditor({
    schema,
    content: [{ kind: 'paragraph', text: 'Start writing.' }],
  });

  return (
    <EditorProvider editor={editor}>
      <Toolbar />
      <EditorContent editor={editor} />
    </EditorProvider>
  );
}

function Toolbar() {
  const editor = useCurrentEditor();
  const undo = useCommandState(editor, 'undo');

  return (
    <button disabled={!undo?.available} onClick={() => editor?.commands.undo()}>
      Undo
    </button>
  );
}
```

`useEditor` returns `null` on the server and until its effect commits. It creates
no session, extension resources or view during rendering. The hook destroys only
its own session when unmounted or when the schema/document identity changes.
Strict Mode effect replay destroys the first session before creating another.
Creation errors reach the nearest React error boundary.

The schema and optional `documentId` determine session identity. Content, selection
and revision options initialize that session; rerendering with another content
object does not overwrite edits. Use a different document ID or React key when
opening a different document. Keep the schema instance stable.

`EditorContent` mounts the framework-independent view and accepts a nullable
session. It owns the view, never the supplied session. Its view settings and
readiness/error callbacks are the same as the vanilla mount. Applications that
already own a session can pass it directly without `useEditor` or a provider.

The provider is also a borrower. `createEditorContext(schema)` binds its provider
and consumer hook to the assembled schema, preserving inferred node types and
extension commands without unchecked generic casts or globally augmented types.
The provider rejects a session from a different schema instance. A missing provider
is an error; a provider with a null editor represents the loading state. Provider
values do not change for ordinary transactions. Toolbar selectors subscribe to
only the derived state they need.

`useEditorState` accepts a nullable editor. When no editor is available it returns
`undefined` without calling the selector. Existing non-null callers keep their
non-null return type. The hook subscribes to the same session as vanilla consumers.

`useCommandState(editor, name, ...args)` subscribes to an installed command's
availability and activity. Names and arguments use the assembled schema's types,
just like `editor.getCommandState`. It returns `undefined` while the session is
null and suppresses renders when availability and activity are unchanged.

The main demo uses `useEditor` for session ownership and `EditorContent` for its
view. Its workspace UI receives the committed session as a borrowed prop.

## Ownership choice

We considered constructing a session in a state initializer during render, and
constructing it after commit. Render-time creation makes the first return value
available sooner, but extension setup may allocate resources. Abandoned renders
and Strict Mode render replay have no corresponding cleanup effect. The selected
commit-time owner exposes a null loading state and keeps allocation/release paired.
A private external store publishes the owned session to React without making
ordinary transactions rerender the owner.

For context, an erased global provider with caller-selected generics would allow
a consumer to claim commands from the wrong schema. A schema-bound context keeps
that relation in the type system and verifies the schema instance at the provider.
It adds one module-level context declaration while preserving simple provider and
consumer usage. Neither the provider nor the content host takes ownership of a
borrowed session.
