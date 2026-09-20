# Marks and document codecs

The core supports semantic mark ranges without imposing a node storage shape. Text extensions expose `editing.marks.read(node)` and `write(node, ranges)`. They may store ranges directly or project them to their own representation. The demo currently projects bold, italic and underline to its existing compact layout spans; arbitrary custom-mark rendering is not implemented in that demo.

## Mark schema

`createMarkSchema` registers named, versioned attribute parsers. Attributes are JSON values. For example:

```ts
const marks = createMarkSchema([{
  name: 'link', version: 1,
  parse(value) {
    const attrs = jsonRecord(value);
    const href = jsonString(attrs.href);
    if (!href.startsWith('https://')) throw new Error('Expected an HTTPS link');
    return {href};
  },
}]);
const link = marks.create('link', {href: 'https://example.com'});
```

`MarkRange` holds `{from, to, mark}` within one text node. Different types can overlap. At a given location, one type has one attribute value. `setMark` replaces that type only within the supplied interval; `removeMark` can remove one type or every type. `normalizeMarks` merges adjacent equal values and rejects conflicting overlaps. Attribute comparison ignores object-key order. `sliceMarks` projects a fragment to local coordinates.

`marks.validate(text, ranges)` checks grapheme boundaries and attribute values. `marks.encode` and `decode` include each mark extension's version; unknown types and unsupported versions reject instead of silently dropping formatting. There is no automatic version migration.

`changeSelectionMarks(schema, state, change)` returns ordinary transaction steps. It supports the selection's text ranges, including disjoint ranges, through the registered text capabilities. Run those steps through `editor.chain().steps(steps).run()` for one undo event. `selectionHasMark` checks full coverage. Read-only nodes are rejected by the existing transaction permission checks. These range commands act on nonempty selections. At a caret, the session supplies stored marks for subsequent typing (below).

Text replacement, split and join semantics still belong to each text extension. The demo retains its current span editing behavior. Marks are document content; comments remain external decorations.

## Document codec

A node extension can provide `codec.encode(node)` and `codec.decode(data, {identity, children})`. Core owns the envelope, traversal and identity checks; the extension owns its payload parser. A codec is required for every node type being persisted. No serialization happens during editing or layout.

```ts
const codec = createDocumentCodec(schema);
const saved = JSON.stringify(codec.encode(editor.state.nodes));
const restoredNodes = codec.decode(JSON.parse(saved));
```

The envelope stores format version 1, then each node's type, schema version, ID, durable key, optional lock, payload and children. Decoding rejects unsupported versions/types, invalid identities, duplicate keys or IDs, children on non-containers, and extension violations of child order or identity. Extension child constraints run on the completed tree. Decoding is bounded to one million nodes and 256 nested levels. Encoded payloads are detached JSON copies; unsupported values reject instead of being silently lost by JSON serialization.

`demoDocumentCodec` covers the current starter kit: paragraphs, headings, quotes, lists/items, table cells/tables, mentions inside text, checklists and images. Text payloads use semantic marks. Table row indices must agree with the serialized structure.

This is document serialization, not a complete session backup. Restoring durable external ranges also requires the same document ID, revision and position checkpoint, as described in [reference persistence](editor-references.md). Threads are stored separately. Undo history, authentication, protected-content projection, automatic persistence, collaborative delivery and migrations are not supplied by this codec. A protected client must receive a trusted projection, never the full canonical document envelope.

## Validation and performance

The full browser suite passes 141 tests across Chromium, Firefox and WebKit; three pre-existing concurrent split/insert tests remain skipped. Coverage includes a foreign node codec, attribute-bearing marks, invalid input rejection, nested starter-kit round trips, permission-aware formatting, undo and checkpoint-based reference restoration. Existing rich clipboard checks pass in all three browsers.

On the development server, three warmed Chromium trials of the 7,280-block Warbreaker document measured median encoding at 7.1 ms, JSON stringification at 4.1 ms, and parsing plus validated decoding at 120.5 ms. The JSON envelope is 2,143,127 bytes. This is synchronous bulk decoding; worker/incremental decoding remains an option for avoiding a long initial task. See [codec measurements](../artifacts/schema-codecs/book.json).

The [interactive regression measurements](../artifacts/editor-marks-codecs/baseline.json) remain near the previous integration baseline: 971 ms progressive loading, 51 ms paste handling, 95.8 ms paste-to-paint and 31.8 ms typing-to-paint. Measurements include frame scheduling. Registration exposes a frozen catalog copy; the private array used in repeated schema resolution remains unfrozen, after measurement showed frozen-array iteration regressed bulk operations.

## Stored marks and typing

`editor.state.storedMarks` distinguishes `null` (inherit at the caret) from `[]` (explicitly type without marks). `editor.setStoredMarks(marks)` changes this session state without modifying document nodes, revision or undo history. It validates against the text adapter's optional `validate` function and current edit permissions, copies the supplied marks, and separates the next typing history group. The demo adapter validates every type and its attributes.

`inputMarks(schema, state)` reads the effective formatting. At a collapsed caret, the left-hand text supplies formatting; offset zero uses the right-hand text. Replacing a selection uses the first selected character's formatting. Moving the selection clears explicit overrides. Stream appends preserve them. Mark boundary affinity is currently this fixed policy, not separately configurable per mark type.

Local input transactions opt in with `input: true`. Text insertion and range replacement apply the effective marks to the inserted graphemes; splitting a paragraph retains them for the next input. Regular programmatic transactions and rich pasted fragments retain their existing formatting behavior. This is a local input convenience, not a serialized collaboration protocol: a future transport must send resolved content/mark operations rather than depend on another actor's stored marks.

Undo and redo restore the corresponding selection and stored marks. Toggling a toolbar format or clearing formatting at a caret leaves existing text unchanged. The demo connects these behaviors to its existing toolbar and keyboard formatting shortcuts, including table-cell input. Stored marks remain transient session state and are not part of document JSON.

Stored-mark integration was checked in all three browsers, including table focus, combining characters, cross-paragraph replacement, pending overrides during streaming, permission rejection and history restoration. The [latest book measurements](../artifacts/editor-stored-marks/baseline.json) report medians of 1,059 ms loading, 54.9 ms paste handling, 105.3 ms paste-to-paint and 31.6 ms typing-to-paint; these remain within the existing regression budgets.
