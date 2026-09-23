# Marks and document codecs

The assembled schema supports semantic marks and inline values through installed
definitions. A text node declares its text, mark and inline fields in its content
specification; assembly supplies editing and validation behavior. The starter kit
stores semantic `marks` directly and projects bold/italic into layout style runs.
Underline uses a schema-bound mark renderer. See [rendering extensions](rendering-extensions.md)
and [decoration widgets](decorations.md#widgets) for canvas, DOM and React rendering.

## Mark schema

Use `defineMark` and assemble it with the consuming text definitions. Attributes
use a synchronous Standard Schema validator and must normalize to JSON values:

```ts
import { createSchema, defineMark } from '@gprose/model';
import { paragraph } from '@gprose/extension-document';
import { z } from 'zod';

const Link = defineMark({
  name: 'link',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ href: z.url().refine((url) => url.startsWith('https://')) }),
  }),
});
const schema = createSchema({ extensions: [paragraph, Link] });
const link = schema.value(Link).create({ href: 'https://example.com' });
```

`MarkRange` holds `{from, to, mark}` within one text node. Different types can overlap. At a given location, one type has one attribute value. `setMark` replaces that type only within the supplied interval; `removeMark` can remove one type or every type. `normalizeMarks` merges adjacent equal values and rejects conflicting overlaps. Attribute comparison ignores object-key order. `sliceMarks` projects a fragment to local coordinates.

`schema.marks.validate(text, ranges)` checks grapheme boundaries and attribute
values. The document codec includes each mark definition's version; unknown types
and unsupported versions reject instead of silently dropping formatting. There is
no automatic version migration. Defining a mark does not itself add a renderer,
toolbar command or HTML serializer; those are separate extension contributions.

`changeSelectionMarks(schema, state, change)` returns ordinary transaction steps. It supports the selection's text ranges, including disjoint ranges, through the registered text capabilities. Run those steps through `editor.chain().steps(steps).run()` for one undo event. `selectionHasMark` checks full coverage. Read-only nodes are rejected by the existing transaction permission checks. These range commands act on nonempty selections. At a caret, the session supplies stored marks for subsequent typing (below).

The compiled text capabilities map marks and inline values through replacement,
split and join. Structural commands belong to editing extensions. Marks are
document content; comments remain external decorations.

## Document codec

Assembly generates codecs from each node/mark/inline definition. Model owns the
envelope, traversal and identity checks. A node definition may supply a
`persistence` adapter to preserve an established wire payload; it does not own the
identity or child envelope. No document serialization happens during editing or layout.

```ts
const codec = createDocumentCodec(schema);
const saved = JSON.stringify(codec.encode(editor.state.nodes));
const restoredNodes = codec.decode(JSON.parse(saved));
```

The envelope stores format version 1, then each node's type, schema version, ID, durable key, optional lock, payload and children. Decoding rejects unsupported versions/types, invalid identities, duplicate keys or IDs, children on non-containers, and extension violations of child order or identity. Extension child constraints run on the completed tree. Decoding is bounded to one million nodes and 256 nested levels. Encoded payloads are detached JSON copies; unsupported values reject instead of being silently lost by JSON serialization.

`createDocumentCodec(schema)` covers the installed definitions, including custom
nodes. Starter definitions include paragraphs, headings, quotes, lists/items,
table cells/tables, mentions and images. Text payloads use semantic marks.
Table row indices must agree with the serialized structure.

This is document serialization, not a complete session backup. Restoring durable external ranges also requires the same document ID, revision and position checkpoint, as described in [reference persistence](editor-references.md). Threads are stored separately. Undo history, authentication, protected-content projection, automatic persistence, collaborative delivery and migrations are not supplied by this codec. A protected client must receive a trusted projection, never the full canonical document envelope.

## Validation and performance

Current required checks include foreign node codecs, attribute-bearing marks,
invalid input rejection, nested starter-kit round trips, permission-aware
formatting, undo, checkpoint restoration and rich clipboard behavior in three
browsers. Use `pnpm run check` for current results. The measurements below are the
historical pre-package-migration codec study, not new timings for this build.

On the development server, three warmed Chromium trials of the 7,280-block Warbreaker document measured median encoding at 7.1 ms, JSON stringification at 4.1 ms, and parsing plus validated decoding at 120.5 ms. The JSON envelope is 2,143,127 bytes. This is synchronous bulk decoding; worker/incremental decoding remains an option for avoiding a long initial task. See [codec measurements](../artifacts/schema-codecs/book.json).

The [interactive regression measurements](../artifacts/editor-marks-codecs/baseline.json) remain near the previous integration baseline: 971 ms progressive loading, 51 ms paste handling, 95.8 ms paste-to-paint and 31.8 ms typing-to-paint. Measurements include frame scheduling. Registration exposes a frozen catalog copy; the private array used in repeated schema resolution remains unfrozen, after measurement showed frozen-array iteration regressed bulk operations.

## Stored marks and typing

`editor.state.storedMarks` distinguishes `null` (inherit at the caret) from `[]`
(explicitly type without marks). `editor.setStoredMarks(marks)` changes this
session state without modifying document nodes, revision or undo history. It
checks the compiled text capability and current edit permissions, owns the supplied
marks, and separates the next typing history group.

`inputMarks(schema, state)` reads the effective formatting. At a collapsed caret, the left-hand text supplies formatting; offset zero uses the right-hand text. Replacing a selection uses the first selected character's formatting. Moving the selection clears explicit overrides. Stream appends preserve them. Mark extensions can override this default with `inclusiveStart` and `inclusiveEnd`. Text adapters expose the mark schema's `boundary` query. Selected-text replacement inherits the first selected character regardless of caret boundary inclusion.

Local input transactions opt in with `input: true`. Text insertion and range replacement apply the effective marks to the inserted graphemes; splitting a paragraph retains them for the next input. Regular programmatic transactions and rich pasted fragments retain their existing formatting behavior. This is a local input convenience, not a serialized collaboration protocol: a future transport must send resolved content/mark operations rather than depend on another actor's stored marks.

Undo and redo restore the corresponding selection and stored marks. Toggling a toolbar format or clearing formatting at a caret leaves existing text unchanged. The demo connects these behaviors to its existing toolbar and keyboard formatting shortcuts, including table-cell input. Stored marks remain transient session state and are not part of document JSON.

Stored-mark integration was checked in all three browsers, including table focus, combining characters, cross-paragraph replacement, pending overrides during streaming, permission rejection and history restoration. The [latest book measurements](../artifacts/editor-stored-marks/baseline.json) report medians of 1,059 ms loading, 54.9 ms paste handling, 105.3 ms paste-to-paint and 31.6 ms typing-to-paint; these remain within the existing regression budgets.

## Inline values

The starter kit stores `inline: InlineValue[]`, where each value has `id`, `index`,
`type`, and JSON `attrs`. `defineInline` declares a named/versioned attribute
schema and a plain-text projection. `createSchema` assembles those definitions;
layout metrics belong to separate `defineInlinePresentation` contributions from
`@gprose/view`. Generic editing helpers preserve values through insertion,
deletion, slicing and joining. Unknown types, unsupported versions, malformed
attributes and invalid replacement-character positions reject at decode.

Mentions use this interface; their label and dimensions belong to the mention extension. Document codecs no longer know mention fields. Other extensions can define different attributes and layout results, as the foreign equation extension test demonstrates. The owned layout engine still receives compact inline boxes, which are renderer data rather than document storage.

Paragraph/heading schema versions are now **2** because their serialized inline payload changed from `atoms` to versioned `inline` values. Version 1 documents need an explicit migration and are rejected by the codec. The demo samples and clipboard HTML are imported afresh and do not require migration. No automatic schema migration was introduced.
