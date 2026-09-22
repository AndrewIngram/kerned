# Accessibility for the canvas editor

Research date: 2026-09-22. This records the starting implementation and a proposed
sequence. It does not establish screen-reader compatibility or WCAG conformance.
No real assistive-technology testing was performed for this research.

## Prior discussion and Google Docs evidence

The user supplied two earlier ChatGPT discussions as context:

- "Google Docs accessibility architecture", conversation
  `6ab25d38-6dc4-83eb-9336-1bf9020b01da`.
- "Google Docs Canvas Move", conversation
  `6aaf42e7-a6dc-83ed-ab4c-1b28f2e271b2`.

They propose a separate accessible DOM projection of the shared model, potentially
using a windowed editable DOM proxy, mapped selection and live announcements.
Their descriptions of Google's hidden editable iframe, exact markup and windowing
policy are observational claims or architectural inference. This research has not
verified those internals against current Google source or a live inspection.

Google's published 2021 announcement verifies the move to canvas and says support
for screen readers, braille devices and magnification would continue. It does not
specify the internal accessibility adapter. [Google's canvas announcement](https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html)

Current Google help verifies an explicit screen-reader support setting and
product-specific interaction guidance, including NVDA focus mode and VoiceOver
Quick Nav configuration. Separate Docs guidance documents heading navigation and
commands for announcing formatting. These demonstrate supported product behavior,
not proof of a particular DOM architecture. [Google screen-reader setup](https://support.google.com/docs/answer/6282736?hl=en),
[Google Docs reading and editing commands](https://support.google.com/docs/answer/1632201?hl=en)

## Recommendation

Keep the document model and transaction pipeline authoritative. Improve the
existing native textarea as an editing bridge, then add a semantic reading
representation owned by the view and supplied by extensions. Canvas remains the
visual renderer. React remains optional.

These solve different problems. A textarea can expose editable text and native
selection for the current block. A semantic document can expose headings, lists,
table relationships, image descriptions and custom content. Neither alone gives
us a complete accessible rich-text editor.

The user clarified that accessibility should project the document state. The first
implementation uses a read-only semantic DOM and the existing textarea bridge; it
does not require `contenteditable` or a second document model.

The HTML standard requires canvas alternatives that convey its function or
purpose. It also describes mapping interactive canvas regions to focusable
fallback elements. A label such as "Canvas document" does not represent the
document's content or editing operations. [HTML canvas requirements](https://html.spec.whatwg.org/multipage/canvas.html#the-canvas-element)

## Starting implementation

These observations describe the code inspected before the accessibility work in
this wave. Subsequent implementation may resolve individual findings.

| Finding                                                                                                        | Source                                                                                                                                    | Consequence                                                                                                 |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| The canvas has a generic label and no semantic document children.                                              | `packages/view/src/canvas/mount.ts`                                                                                                       | Headings, text and document structure have no complete reading representation.                              |
| The input uses `tabIndex = -1`; the mount has no ordinary editor tab stop.                                     | `packages/view/src/canvas/mount.ts`                                                                                                       | Keyboard users cannot reliably enter the canvas editor through normal tab navigation.                       |
| Single-block selection copies the block text into a textarea, but calls `setSelectionRange` without direction. | `packages/view/src/browser/text-input.ts`                                                                                                 | Backward selection loses its native anchor/head direction.                                                  |
| Cross-block and non-text selections clear the textarea.                                                        | `packages/view/src/browser/text-input.ts`                                                                                                 | Native accessible text does not represent the selected document range.                                      |
| Native selection observation only handles Select All.                                                          | `packages/view/src/browser/text-input.ts`                                                                                                 | Caret or partial selection changes made through native selection APIs do not generally reach editor state.  |
| List and table handlers consume Tab for structural operations.                                                 | `packages/extension-editing/src/input.ts`, `packages/extension-table/src/table-view.ts`                                                   | A tab stop alone does not establish predictable entry and exit.                                             |
| Static serializers have semantic HTML output but no access-policy argument.                                    | `packages/core/src/serialization.ts`, `packages/extension-document/src/serialization.ts`, `packages/extension-table/src/serialization.ts` | Export output is useful design precedent, but unsafe as an unfiltered reading mirror of a trusted document. |

The public `defineNodeView`, `defineInlineView` and `defineMarkView` APIs already
bind renderers to installed schema definitions. Node render frames include access
and scoped selection. A semantic registration should follow that pattern, without
depending on mounted React components or changing the core schema's node union.

## First bounded implementation

1. Give the native editing entry a consumer-supplied accessible name and a normal
   keyboard entry path. Preserve the current selection when focus returns. Draw a
   discernible focus indicator rather than exposing only a transparent control.
2. Preserve textarea selection direction when synchronizing model selection.
   Observe native partial selections and collapsed caret movement, including
   changes that arrive without a keydown. Map only from the current input capture
   and do not interpret a stale or composing capture as a new document selection.
3. Suppress feedback from programmatic synchronization by comparing the expected
   input value and selection. Native selection events can arrive after the
   synchronous setter returns. A short-lived boolean around the setter is not
   enough on its own.
4. Keep composition ownership in the mount. Do not replace the input value during
   composition or let a selection observer turn composition's temporary native
   range into a separate editor operation.
5. Define and test how keyboard users leave lists and tables. If Tab remains an
   editing command, provide discoverable instructions and an explicit focus-exit
   operation. Avoid stealing browser and assistive-technology shortcuts.

The textarea API explicitly represents forward and backward selection, so it is
the appropriate bridge for this first slice. This does not prove that every
screen reader announces programmatic selection correctly. [Native textarea
selection](https://developer.mozilla.org/en-US/docs/Web/API/HTMLTextAreaElement/setSelectionRange)

The APG distinguishes focus from selection, recommends predictable focus order,
and describes Tab as navigation between components. It also requires authors to
implement keyboard behavior for custom ARIA widgets. These are useful contracts
for our mount and extension input policies. [Keyboard interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)

## Two input adapter directions

Both options keep our schema, transactions, history, permissions, layout and
canvas selection authoritative. Their difference is what the browser exposes as
editable content to assistive technology.

| Direction                                          | Benefit                                                                                       | Cost or unresolved behavior                                                                                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native textarea plus separate semantic reading DOM | Builds on current input/composition handling and preserves a strict ban on `contenteditable`. | The editing control exposes plain text. Rich reading and editing are separate contexts; cross-block edits need separator mapping and custom commands.                                              |
| Accessibility-only `contenteditable` projection    | Can expose an editable structured passage and native DOM selection across its text nodes.     | Adds browser mutation reconciliation, DOM/model position mapping and selection/composition lifetime rules. It still needs real AT testing and does not guarantee all rich semantics are announced. |

If the user permits the second option, I recommend a bounded prototype with
paragraphs, headings and a simple cross-paragraph selection before investing in
general textarea flattening. This recommendation is an architectural judgment,
not a verified statement that Google's implementation works this way.

The editable projection should expose one stable semantic window, independent of
the visual viewport. DOM positions map to model positions. Cancel supported
`beforeinput` operations, convert their intent to core commands, and update both
projections from the resulting state. The Input Events specification supplies
target ranges for contenteditable hosts, while textarea events use value offsets.
[Input Events Level 2](https://www.w3.org/TR/input-events-2/)

Cancellation cannot be the only correctness mechanism. Some input modifications
have no cancelable `beforeinput`, particularly around composition and native
correction. Reconcile the allowed native mutation through a narrowly defined
capture, or restore the authoritative state after rejecting it. Never import an
arbitrary mutated DOM subtree as trusted document content. [Browser beforeinput
behavior](https://developer.mozilla.org/en-US/docs/Web/API/Element/beforeinput_event)

During composition, retain the composing DOM nodes and mapped anchor. Route
native history intentions to our undo/redo; do not create a second independent
history stack. Reject edits that cross protected boundaries before publishing
transactions. Remote edits and permission revocation must invalidate or remap a
capture explicitly. These requirements apply even when the projection is visually
hidden and enabled only in an accessibility mode.

The prototype should prove cross-paragraph AT selection, replacement, backward
selection, composition, undo and focus return. Test semantic announcements inside
the editable host rather than assuming that adding heading/list tags or a textbox
role preserves every structure in the accessibility tree. A static reading
representation may still be useful alongside the editing projection.

## Semantic reading representation

Add a browser contribution whose registration binds to a node, mark or inline
definition and returns a constrained semantic description. Let the view own DOM
creation, keyed updates, access filtering and destruction. Let extensions own
their meaning. Paragraph, heading, list, quote and table names should not appear
in the generic view implementation.

The description needs structural semantics, readable text, optional language and
direction, and mappings between semantic text offsets and model positions. A
heading extension supplies its level; a table extension supplies rows, headers
and spans; an image extension supplies its alternative text. Custom containers
retain semantic children. Missing custom semantics must be visible as a reported
capability gap, rather than quietly dropping the content.

Use native HTML semantics where possible. A static table reading representation
and an interactive table grid are different contracts. The latter additionally
needs a focus model, cell navigation and selection behavior. Adding `role="grid"`
to the current table does not implement them. [APG grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)

Do not inject exported HTML into the mounted editor. Static serializers permit
trusted extensions to choose arbitrary tags, attributes and URLs. Live reading
DOM needs stricter ownership: no duplicated active controls, no side effects from
loading exported resources, and no script or event-handler attributes. Reuse
extension semantic knowledge through constrained descriptions; do not grow a
second handwritten starter-schema switch inside the view.

Keep a single active editing input. The semantic reader should not add a textarea
for every paragraph. Likewise, a React overlay button should remain one real
button, not acquire another operable copy in the reading tree. Its extension must
declare where its accessible interaction lives. This requires testing duplicate
announcements and reading order with actual screen readers.

Do not apply `role="application"` to the entire document to capture more keys.
Do not use `aria-selected` on arbitrary paragraphs to stand in for a text range.
ARIA describes widget selection, while textarea and DOM text selections have
their own APIs. Hide only redundant canvas graphics once an equivalent reading
representation exists; never hide ancestors containing the focused input or
active overlay controls. [WAI-ARIA roles and states](https://www.w3.org/TR/wai-aria-1.2/)

## Reading, selection and editing must connect

A screen-reader browse cursor is not the editor's selection. Making headings and
paragraphs readable does not automatically support editing at the reader's
current word. A later slice must define an explicit path from reading content to
an editor position and back, preserving direction and selection affinity.

Start with block activation and current-block text editing. Then implement a
contiguous native text capture spanning multiple blocks with explicit separators
and an offset map. The map must distinguish real text, synthetic boundaries and
inline alternatives. Replacing a mention's readable label must not interpret its
label length as the model's atomic inline width. A cross-table selection must not
be mistaken for a flat string replacement.

Keep the mapping local to the input bridge and use existing core transactions for
all writes. Reject unsupported native edits with a useful status message until
their structural mapping is implemented. Never apply a plausible text diff to
the wrong node because the exposed capture advanced to a different block.

Use the existing status region for errors, permission failures and concise
operation results. Do not make the entire document an `aria-live` region or
announce its full content on every edit. Status announcements complement native
text feedback. [W3C status message guidance](https://www.w3.org/WAI/WCAG21/Understanding/status-messages)

## Large documents and streaming

The reading representation must not follow visual viewport culling. Otherwise a
screen reader can lose a paragraph merely because the canvas scrolled, and cannot
browse unread content ahead of the viewport. Preserve stable semantic identities
and rebuild only changed branches; selection-only updates must not reserialize
the book.

Measure the cost of a full semantic tree independently of canvas layout. For
larger documents, use an explicit reading-page policy that preserves structural
ancestors, has accessible previous/next navigation, and retains the active
reading page while focus remains inside it. Do not silently truncate the
document to a fixed number of blocks. Expose loading state and navigation to
available headings without pretending that unloaded text is present.

This is a design recommendation to validate, not an established browser recipe.
VS Code documents text pagination as its editor screen-reader strategy. That is
useful precedent for bounded native text, but it does not establish how our rich
document tables and inline atoms should work. [VS Code accessibility](https://code.visualstudio.com/docs/configure/accessibility/accessibility)

For the first semantic implementation, use small complete documents and a
separate large-document benchmark. Do not enable a full unbounded hidden DOM tree
for Warbreaker by default before measuring memory, update latency and reading
stability. Offscreen clipped text also does not solve accurate on-screen text
bounds for magnification, spoken-word highlighting or braille routing.

## Protected content

Consult effective inherited access before reading node attributes, traversing
children or invoking an extension's semantic callback. Protected nodes produce a
generic placeholder. Their text, titles, alt text, inline labels, comments and
descendant count must not leak through accessible names, descriptions, status
messages, offscreen DOM or native capture. Read-only content remains readable.

Permission-only updates must invalidate this representation even when canonical
node identity is unchanged. If access is revoked during composition or native
selection, clear stale capture and restore a permitted position. Locking controls
deletion policy; it must not be confused with read visibility.

Client-side omission is not a confidentiality boundary. The existing
`projectDocument` documentation correctly requires the authority to withhold
protected source content and operations. Accessibility must respect that same
projection, while also avoiding new accidental disclosures in trusted local
sessions. See `packages/state/src/permissions.ts` and
`packages/state/src/transactions.ts`.

## EditContext is a separate future adapter

EditContext can improve native text-input integration, but the current W3C draft
explicitly says its text is not exposed to assistive technology. It still requires
accessible DOM. Its canvas guidance also calls for alternative text at matching
screen positions for accessibility features that use geometry. It therefore
cannot replace this work. [EditContext accessibility](https://www.w3.org/TR/edit-context/#accessibility)

Keep the textarea path while browser coverage is incomplete. Any EditContext
experiment should reuse our input mapping and semantic representation rather
than create a second editor model. [EditContext browser availability](https://developer.mozilla.org/en-US/docs/Web/API/EditContext)

## Verification and remaining limits

Automated browser coverage should include keyboard entry and exit, accessible
names, forward/backward native selections, caret-only native movement, delayed
selection events after synchronization, composition, document replacement,
undo/redo and permission changes. Semantic tests should cover nested headings and
lists, merged tables, custom schema definitions, inline atoms, focused overlays,
streaming and protected ancestors. Run them in Chromium, Firefox and WebKit.

DOM assertions and automated accessibility checks cannot establish a usable
screen-reader editing experience. Before describing the editor as accessible,
test at least VoiceOver with Safari and NVDA with Firefox and Chromium. Record
browser, operating system and assistive-technology versions and observed failures.
Include heading/table navigation, spelling by character, word selection,
cross-block selection, IME composition, toolbar return-focus behavior, and long
documents. Braille and speech-input workflows need their own validation.

The first keyboard/selection bridge remains a partial improvement. Complete
semantic navigation, cross-block native selection, accurate accessible text
geometry, mobile assistive technology and rich interactive custom-node behavior
remain separate deliverables.

## Implemented checkpoint (2026-09-22)

The mount now provides keyboard entry, configurable labels and instructions,
Escape-Tab exit, and native caret/backward-selection mapping. The opt-in semantic
reading view uses schema-bound descriptions from extensions. It represents text,
headings, quotes, lists, images and table rows/cells (including spans); inline
alternatives use the schema's plain-text projection. Permissions are checked
before semantic callbacks and descendant traversal. Permission updates remove
protected DOM and clear protected native capture during composition.

The projection retains unchanged elements, ignores selection-only updates, and
has an independent lifetime from viewport culling. It remains a complete DOM of
the loaded document, not a paginated accessible document. It is enabled for the
small demo samples; streamed books leave it disabled. See [the public contract](editor-accessibility.md).

Synthetic Chinese composition tests cover candidate replacement, trailing input,
and one undo group on both canvas capture and table textareas in all three browser
engines. These validate our event handling, not a native IME candidate window.
The Mac was locked during the native-browser test attempt, so no VoiceOver or
native IME compatibility result is claimed. Manual testing remains required.
