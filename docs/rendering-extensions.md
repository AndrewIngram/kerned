# Inline and mark rendering

Register inline objects and semantic mark renderers through `viewLayers` from
`@gprose/view`. `defineInlineView` and `defineMarkView` bind the installed
schema definition and own instance placement, caching and destruction. They work
with canvas drawing, DOM overlays, or both. Underlines and mentions use these
contracts in the demo and vanilla mount.

```ts
context.provide(
  viewLayers,
  defineMarkView(underline, () => () => {
    let current: MarkViewFrame<typeof underline> | undefined;
    return {
      update(frame) {
        current = frame;
      },
      draw(drawing, layer) {
        if (!current || layer !== 'content') return;
        for (const fragment of current.fragments) {
          drawing.rect(
            {
              left: fragment.left,
              top: fragment.baseline + 2,
              width: fragment.width,
              height: 1,
            },
            current.color,
          );
        }
      },
      destroy() {
        current = undefined;
      },
    };
  }),
);
```

`MarkViewFrame` includes normalized `attributes`, the owning node identity,
UTF-16 `from`/`to`, the block width/height, resolved text color and every wrapped
line fragment. A fragment supplies `left`, `top`, `width`, `height` and `baseline`
in block-local coordinates. Drawing uses the same coordinates; the view supplies
document placement, scrolling and zoom. The underlying text remains canvas-owned.

Both mark and inline frames include the owning node's effective `access`, including
ancestor restrictions. `editor.refreshPermissions()` updates these props after an
external policy change. Unchanged access skips unrelated renderer updates; access
changes do not reshape text. Editing commands remain the authority for checking
whether an operation is permitted.

`InlineViewFrame` includes normalized `attributes`, the text-node identity,
inline `id`, UTF-16 `index`, and allocated `width`/`height`. Its drawing and overlay
coordinates start at the inline box's top-left. The text presentation reserves
that box, including width, ascent and descent. A renderer does not independently
change those metrics; update the document/presentation to change allocation.

Factories receive the imperative editor, `prepareText` and `invalidate`. They
return an instance factory receiving `createOverlay()`. This method lazily creates
one positioned DOM host and returns the same host on subsequent calls. Canvas-only
renderers allocate no overlay. Pass `{ size: 'content' }` on the first call for a
host sized by its DOM children; the default is the supplied bounds. The sizing
policy is fixed for that instance. Subsequent calls must use the same policy.
The view removes the host on culling, destruction
or failure. Calls after destruction throw. Overlays default to
`pointer-events: none`; interactive children opt in with their own CSS. The shared
pointer policy leaves buttons and inputs alone. A noninteractive mark overlay
can pass clicks through to the underlying text without selecting the entire node.

`update(frame)` runs when that instance's data or geometry changes. Moving the
whole block updates the host position without rerunning its renderer. Optional
`draw(drawing, layer)` runs for each paint plane with a borrowed drawing context.
Prepare labels outside that callback. External state can request `invalidate()`;
requests coalesce, update resident instances and schedule canvas repaint. Release
instance-owned subscriptions and listeners in `destroy()`. Factory code that
throws before returning must release its own partial resources.

## React

```tsx
function Badge({ attributes, width, height }: ReactInlineViewProps<typeof badge>) {
  const theme = useContext(ApplicationTheme);
  return (
    <button style={{ width, height, pointerEvents: 'auto' }} className={theme.badge}>
      {attributes.label}
    </button>
  );
}

context.provide(viewLayers, defineReactInlineView(badge, Badge));
context.provide(viewLayers, defineReactMarkView(reviewMark, ReviewMark));
```

The React registrations and prop types come from `@gprose/react`. They use
the same instance owner and portal host as React node views. `ReviewMark` receives
`ReactMarkViewProps<typeof reviewMark>` and can render a positioned element for
each entry in `fragments`. One component represents the whole range, including
all wrapped fragments. React reconciliation, application context, error boundaries
and local component state work normally. `EditorContent.onReady` waits for the
initial portal commit. A vanilla mount rejects React renderers explicitly.

An inline instance keeps its identity while the same inline ID moves within its
text node. Marks have no persistent instance ID: their current node and endpoints
identify each mounted range. Changing those endpoints may remount the component.
Use document attributes, session state or externally stored durable ranges for
persistent meaning; mounted React state is temporary. Culling unmounts components.
Focused controls pin their owning text block until focus leaves, so scrolling
does not tear down the active control.

## Ownership decision

We considered extending each feature's layer with its own DOM map and adding
React portals directly to those implementations. That would leave every new
inline type responsible for matching schema values, positioning hosts, reflow,
cache invalidation and culling. A framework-independent instance owner now handles
those rules once. Schema-bound projections supply frames; canvas/DOM renderers
consume them; the React adapter only renders and removes portals. Canvas-only
renderers keep their allocation advantage through lazy overlays.

`schema.value(definition)` checks the installed mark/inline definition family.
Configured variants bind to the same family; an unrelated definition with the
same name fails. Reading a canonical value returns its inferred attributes without
rerunning validation or transforms. Input still enters through schema validation.

These contracts currently render canvas text's inline objects and mark ranges.
Native text views retain their native rendering policy. View-only controls use
[decoration widgets](decorations.md#widgets), including React registrations.
Editable content slots remain milestone 6 work. These renderers do not claim to replace native text input
or implement a second editable DOM tree.

## Scoped selection

`editor.getSelection(nodeId)` returns the selection inside that node's subtree,
with `undefined` for a missing node. Renderers receive the same `ScopedSelection`
from `@gprose/state` without traversing the document:

- `none`: no selection inside this scope.
- `caret`: a `point` and `upstream` affinity. The point is a text offset or a
  structural position beside a child. A structural caret belongs to the parent,
  not the child beside it.
- `range`: selected `ranges` inside the subtree. These can be discontiguous, as
  with table cells. An empty text range can be selected content; it is not a caret.
- `node`: the entire node is selected, directly or through a selected ancestor.

Bound vanilla `NodeRenderFrame` and React node props both expose scoped
`selection`. The imperative editor in the factory still provides the global
`editor.state.selection`; the lower-level native `NodeViewFrame` retains its
global selection and context. Inline and mark frames also expose `selection`,
clipped to their own UTF-16 interval. At a
shared interval boundary, an upstream caret belongs to the preceding interval;
otherwise it belongs to the following interval. Whole-node selection stays `node`.
Widget frames report the owning node's scope; the widget is not document content
and does not create another selectable region.

`selectionInText(scope, id, from, to)` clips a text node's scope for custom range
renderers. `equalScopedSelection(a, b)` compares its local meaning, independently
of a text selection's global direction. Default adapters use this comparison to
skip unrelated renders. Selection changes do not recompute mark line fragments.
The session builds one lazy index per selection/document and releases it on the
next edit, selection change or destruction. Permission refresh retains that index.
These offsets describe the current snapshot; use `editor.positions` for durable
references across edits.
