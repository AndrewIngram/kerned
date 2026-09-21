# React extensions

Status: milestone 6 is in progress. Measured React block views and public
[decorations](decorations.md) are implemented, along with
[React inline and mark renderers](rendering-extensions.md) and typed
[React widgets](decorations.md#widgets). Editable content slots and complete
selection/editability props remain.

`EditorContent` attaches the same complete view used by vanilla applications.
It borrows the session and owns its view and React portal host. React components
are registered through the browser's existing node-view contribution:

```tsx
function Card({ attributes, selected }: ReactNodeViewProps<typeof card>) {
  const theme = useContext(ApplicationTheme);
  return (
    <section className={theme.card} data-selected={selected}>
      {attributes.label}
    </section>
  );
}

const cardViews = defineExtension({
  name: 'cardViews',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(nodeViews, defineReactNodeView(card, Card));
    // Also contribute a box presentation for card with an initial height.
    return {};
  },
});
```

`defineReactNodeView` and `ReactNodeViewProps` come from `src/editor-react`;
`nodeViews` and `defineNodeView` come from `src/editor-browser`. Assemble the view
extension alongside its node definition and presentation. There is no second
renderer list on `EditorContent` and no schema name lookup inside the component.
Binding recognizes configured variants of the same definition family.

The component receives immutable normalized `attributes`, readonly node identity,
available `width` and a `selected` flag. Attribute types come from the node's
Standard Schema, including defaults and transforms. The component can use its
application providers and typed editor context to invoke commands. It does not
receive a renderer, shaper, native graphics handle or mutable document reference.

The native view owns placement, viewport culling and selection. A scoped
`ResizeObserver` reports the component's unscaled height with the current width,
so late reports can be rejected by layout. React node updates are suppressed when
the node, width and selected state are unchanged. Application context updates
still reach the component. Interactive controls follow the existing pointer
policy and do not move the editor selection. Events bubble through the content
host and the application's React tree.

`EditorContent.onReady` waits for the initial portal commit after native view
readiness. Errors thrown by custom components reach the application's React error
boundary. When that boundary unmounts the content host, native and React resources
are released. A React node contribution requires `EditorContent`; a vanilla mount
fails explicitly rather than creating a separate React root without context.

## State and culling

The host mounts visible blocks with overscan and pins focused widgets until focus
leaves them. Culling unmounts the component and releases its effects and observer.
Keep persistent semantic state in document attributes, session extension state or
an external store. Local React state belongs to the mounted component and resets
when that component is culled. The tests update a card's document attributes,
scroll it out of the mounted region and verify those attributes on remount.

The existing table and image contributions remain framework-independent. Their
measurement, clipboard and native-input behavior uses the same view lifetime.
Comments and search use the public decoration contribution for both canvas and
native text. Mentions and underlines use schema-bound inline and mark renderers.
The same contracts support canvas drawing and React overlays; components receive
normalized attributes and geometry without private engine access.

## Ownership choice

We considered one independent React root per node and portals under the existing
content host. Separate roots would require copying provider values and managing
another error boundary and root lifetime for every node. Portals preserve the
application tree and let the existing node-view owner request render/removal.

A private registry associates each content-host element with its portal store.
A node destination resolves the nearest registered ancestor only when mounted.
Cleanup removes that registration and pending portals. No React-specific state
or import enters the headless session, browser view or canvas implementation.
The store publishes resident portals through React's external-store subscription;
React owns reconciliation, while the native view owns destination lifetime.

The old `createReactRenderers` application registry is removed. Its test probe now
uses an ordinary React component; mounted custom-node tests exercise the real
registration API, context, measurement, selection and lifetime.
