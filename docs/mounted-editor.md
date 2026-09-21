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
a function receiving normalized attributes plus node identity, child count,
semantic mark ranges and inline values. It returns text/box metrics or a flowing-container policy.
Immutable node presentations are cached per view. Duplicate or missing
presentations produce explicit errors.

Input extensions contribute through `inputPolicies` from `src/editor-browser`.
They receive the imperative session, native text capture, navigation/select-all
helpers and a notice callback. Navigation,
select-all, composition lifetime and focus synchronization belong to the mount;
extensions implement schema-specific edits and clipboard policy. There can be
one text-input owner, with multiple keyboard/clipboard handlers in assembly
order. A prevented keyboard/clipboard event stops further handlers. Without a
text-input owner, the capture is read-only while navigation remains available.

Native node-view factories receive the imperative session, the view's clipboard
dispatcher and a notice callback. Their update frame carries the current
selection and the mount's cached selection context. A view can implement
`focusSelection` for native text controls; the mount resolves the selected
descendant to its rendered owner before falling back to canvas input. The table
extension uses this contract for cell editing and rectangular selection, with
the same clipboard policy as the canvas capture. Its styles belong to the
browser extension and do not require the demo stylesheet.

Transient text-highlight ranges can accompany native frames. This is an internal
rendering contract, not the final extension decoration-authoring interface.

## React

```tsx
import { Editor } from '../src/editor-react';

<Editor editor={editor} style={{ height: 480 }} onReady={(view) => view.focus()} />;
```

React attaches the same native mount and disposes it on unmount or session
replacement. It does not own the session. Callback changes do not remount the
view. Strict Mode cleanup cancels obsolete initialization. `onError` receives
initialization and background view failures, also displayed in an alert.
`onNotice` receives nonfatal input messages such as a rejected paste. The native
mount also announces these messages through a status element.

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
browser starter tuple now contributes text editing and paragraph/heading
presentations. Its input policy supports custom text fields through schema
capabilities and shares command definitions with the named command API.
Mounted browser tests cover typing, stored marks, history, paragraph splits,
native table-cell editing and rich rectangular clipboard operations. Table
cells can contain custom text-node definitions. Ordinary copy/cut and text
paste within a native cell textarea still use its native behavior; this does
not provide rich clipboard parity for every cell text selection yet.
List markers, quote rules and inline/decorations still require adapters before
the complete starter content can use this mount.

The writing demo still uses its existing starter composition and an internal
`EditorEventHost`; it has not switched to this mount yet. It now uses the same
table node-view contribution as the mount, without a separate table branch.
Inline/decorations, native text geometry and diagnostic contracts must be completed before that
switch. The old event host is not a second public editor interface. Milestone 4
remains open until the demo uses the shared mount and stops passing graphics
handles through its tree.
