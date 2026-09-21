# Decorations

Decorations add view-only text highlights or node outlines. They do not change
the schema, document, history or selection. Comments and search both use this
public contribution, in canvas text and native table cells.

```ts
import { defineExtension, type ContributionContext } from '../src/core';
import { decorations, type Decoration, type InvalidateDecorations } from '../src/editor-browser';

type HighlightStore = {
  read(nodeId: number): readonly Decoration[];
  subscribe(listener: InvalidateDecorations): () => void;
};

export function highlightView(store: HighlightStore) {
  return defineExtension({
    name: 'highlightView',
    options: {},
    setup(_options, context: ContributionContext) {
      context.provide(decorations, {
        name: 'highlights',
        dependencies: 'node',
        create() {
          return {
            read: (id) => store.read(id),
            subscribe: (invalidate) => store.subscribe(invalidate),
          };
        },
      });
      return {};
    },
  });
}
```

The store owns immutable results and notifies its subscribers after changing
them. For example, this result highlights part of one node's text:

```ts
const highlight: Decoration = {
  kind: 'text',
  key: 'review:42',
  from: 12,
  to: 38,
  background: '#fff0b3',
  activation: {
    label: 'Open review discussion',
    onActivate(event) {
      openDiscussion(event.key);
    },
  },
};
```

`from` and `to` are UTF-16 offsets in the current node, with an exclusive end.
The feature must project durable references or map its ranges through document
changes before returning offsets. A decoration key identifies a rendered instance
within one source and node. It is not an anchor registered in the document. Keys
must be nonempty and unique in that scope; source names must be unique per editor.
Keep keys stable when a range moves so its mounted controls keep their identity.

Node decorations use `kind: 'node'`, a key and
`outline: { color, width, radius }`. Width and radius use unscaled CSS pixels.
They can carry an `activation.onActivate` callback. This observes clicks on
noninteractive node content; it does not intercept embedded buttons or inputs.
Text and node descriptors accept `data-*` metadata. Text metadata is passed to
native text renderers; text activation metadata belongs to canvas range controls.

## Dependencies and invalidation

`read(id, state)` receives the current immutable editor state. The default
`dependencies: 'document'` rereads resident results whenever that state changes.
Choose it for sources that inspect selection, ancestors, other nodes or mapped
document ranges. Return the same immutable array when a result is unchanged to
reuse projected geometry and native text ranges.

Use `dependencies: 'node'` only when each result depends on that node's identity
and explicitly invalidated external data. An edit to another node then skips the
source read. A source that stores numeric offsets, as in the example, must update
those offsets as the document changes. Node dependency mode does not map them.

Call the subscribed listener with `[nodeId, ...]` after changing those results.
Only those cached node results are discarded. Calling it without IDs invalidates
all results; an empty array does nothing. Invalidations coalesce into a view
update and do not create a transaction. Offscreen changes wait until the node
becomes resident. Source reads and caches cover visible content, overscan and
pinned interaction targets, not the entire document.

## Rendering and lifetime

The mount projects a text range into every wrapped line fragment. Canvas
highlights remain selectable text. Clicking one places the caret normally and
reports `kind: 'text'`; keyboard activation of its accessible range control
reports `kind: 'control'`. The callback includes the node ID, key and offset.
Native editing controls retain their native click and focus behavior. Custom
native renderers receive descriptors through `frame.textDecorations(id)` and
choose how to display or activate them; the table renderer displays backgrounds.

Contributions compose in registration order. Later backgrounds paint over earlier
ones. `viewLayers` remains the lower-level contract for arbitrary drawing such as
list markers, quote rules and inline affordances.

Factories allocate mounted rendering resources, not persistent semantic state.
The canvas layer and native text adapter can create separate source instances.
Native instances are lazy until a renderer requests decorated text. Keep durable
data in the session or an external store, as comments and search do. Culling
discards render caches; remounting reads current data.

Destroying the view unsubscribes every source and calls its optional `destroy()`.
Setup and update errors fail the view and reach its error handler. The session
remains available. Cleanup attempts every owned resource even if one disposer
throws. A pending invalidation cannot update geometry from an older editor state.

Arbitrary decoration-widget registrations and editable content slots remain
milestone 6 work. This API currently supplies text backgrounds, node outlines and
activation. Semantic marks and inline objects have separate
[canvas and React rendering registrations](rendering-extensions.md).
