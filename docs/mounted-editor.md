# Mounted editor interface

The native mount and React component share one view lifetime. The session owns
canonical content, transactions and history. A mounted view borrows that session
and owns its DOM, input capture, viewport, layout, graphics and native node views.

```ts
import { mountEditor } from '../src/editor-canvas';

const view = mountEditor(element, { editor });
await view.ready;
editor.commands.focus();

const caret = view.coordsAt({ id: paragraphId, offset: 3 });
view.destroy(); // The editor session remains usable and can be mounted again.
```

The compiled schema must install presentation contributions for rendered nodes
and flowing containers. Native boxes additionally need node-view contributions.
The mount discovers both from the composed session; callers do not provide an
engine, schema copy, presentation callback or parallel renderer list.

`defineNodePresentation(definition, factory)` binds to the installed definition
family, including configured variants. The factory runs once per view and returns
a function receiving normalized attributes plus node identity, child count and
semantic mark ranges. It returns text/box metrics or a flowing-container policy.
Immutable node presentations are cached per view. Duplicate or missing
presentations produce explicit errors.

Input extensions contribute through `inputPolicies` from `src/editor-browser`.
They receive the imperative session and native text capture. Navigation,
select-all, composition lifetime and focus synchronization belong to the mount;
extensions implement schema-specific edits and clipboard policy. There can be
one text-input owner, with multiple keyboard/clipboard handlers in assembly
order. A prevented keyboard/clipboard event stops further handlers. Without a
text-input owner, the capture is read-only while navigation remains available.

## React

```tsx
import { Editor } from '../src/editor-react';

<Editor editor={editor} style={{ height: 480 }} onReady={(view) => view.focus()} />;
```

React attaches the same native mount and disposes it on unmount or session
replacement. It does not own the session. Callback changes do not remount the
view. Strict Mode cleanup cancels obsolete initialization. `onError` receives
initialization and background view failures, also displayed in an alert.

## Lifetime and coordinates

- `ready` resolves after assets, layout, input and painting have been attached.
  It rejects on initialization failure or destruction during loading.
- `status` is `loading`, `ready`, `failed` or `destroyed`. `error` retains the
  failure. An optional `onError` callback reports initialization and background
  layout/paint errors. Failures release the attachment and allow a fresh mount
  on the same session.
- Session destruction destroys its mounted view, including pending asset loads.
  Destroying an old view again cannot affect a replacement.
- `coordsAt` returns client coordinates for a resident canvas text position, or
  `null` before readiness, after destruction or when no canvas layout is resident.
  Native widget text needs the widget's geometry contract; this method does not
  pretend those positions belong to a canvas paragraph.
- `scroll: 'page'` uses page scrolling and an optional `toolbar` element as the
  sticky inset. The default uses a scroll container inside the supplied host.
  `editor.commands.scrollIntoView()` reveals the current selection.
- `resolveAsset` maps graphics, shaping and font asset paths to application URLs.
  Native engine handles stay private to the mounted view.

## Migration status

This interface is exercised with custom-schema vanilla and React editors. The
writing demo still uses its existing starter composition and an internal
`EditorEventHost`; it has not switched to this mount yet. Starter input, table,
inline/decorations and diagnostic contributions must be migrated before that
switch. The old event host is not a second public editor interface. Milestone 4
remains open until the demo uses the shared mount and stops passing graphics
handles through its tree.
