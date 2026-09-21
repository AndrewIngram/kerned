# Static serialization

Static serializers turn canonical document nodes into HTML and plain text without
mounting an editor view, allocating a DOM or loading fonts. They are independent
of canvas presentation, React components and decorations. External comments do
not become serialized document content.

The assembled starter kit contributes its own serializers. Other extensions use
the same public contracts:

```ts
const output = defineExtension({
  name: 'calloutOutput',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(
      serializers,
      defineNodeSerializer(callout, ({ attributes, content }) => ({
        html: [
          {
            tag: 'aside',
            attributes: { 'data-tone': attributes.tone },
            children: content.html,
          },
        ],
        text: content.text,
      })),
    );
    return {};
  },
});

const serializer = createEditorSerializer(editor);
const { html, text } = serializer.serialize(editor.state.nodes);
```

`defineNodeSerializer` infers attributes from the installed definition, including
configured variants. Its frame contains already-serialized content and children.
For structures such as tables, each child exposes `read(definition)` to inspect
typed attributes while grouping its serialized content. The serializer does not
need a raw node union or a second document traversal.

`defineMarkSerializer` receives inferred attributes and the content it wraps.
`defineInlineSerializer` receives inferred attributes and returns its HTML/text
representation. The model handles intersecting mark ranges, inline positions and
line breaks. Missing serializers reject by default. Duplicate registrations and
bindings to a different definition family also reject.

HTML output is structured data: a string is a text node, and an element contains
`tag`, optional `attributes`, and optional `children`. The encoder escapes text
and attribute values, rejects malformed names and children on void elements, and
bounds nesting. This is not an arbitrary-HTML sanitizer. Trusted extension code
chooses element/attribute semantics and URL policy.

For work without a document session, use the model directly:

```ts
const serializer = createDocumentSerializer(schema, [calloutSerializer, paragraphSerializer]);
const exported = serializer.serialize(canonicalNodes);
```

The optional `{ unsupported: 'text' }` policy deliberately loses unsupported
semantics. Missing text-node serializers produce paragraphs, missing marks lose
their styling, and missing inline serializers use the definition's plain-text
representation. Containers retain child output; unsupported atoms have no text
to preserve. Clipboard export selects this policy explicitly so adding a custom
node without an HTML serializer does not break local copying. Strict export does
not silently choose it.

The starter clipboard adapter uses the session's contributed serializers. Its
same-page immutable fragment token still preserves canonical nodes without a
serialization round trip. The standalone `writeClipboard` helper accepts a
serializer for custom output. Its default is the starter serializer collection
with the explicit text fallback.

## Persistence and interchange

These formats have different purposes:

- `DocumentSnapshot<N>` contains canonical nodes and their revision. It is an
  in-process snapshot, not a complete persistence or collaboration envelope.
- `createDocumentCodec(schema)` encodes and decodes versioned JSON content,
  including stable node identities, attributes, marks, inline values and locks.
  Its validation rejects unknown types and unsupported schema versions.
- `PositionCheckpoint` records the mapping information needed to resolve old
  external references. Persist it with the matching document ID and revision
  when durable ranges must survive reopening.
- Static HTML and text are interchange output. They do not preserve history,
  references, access policy or collaboration state. Plain text is deliberately
  lossy. Interactive rendering components are not an HTML codec.

JSON round trips preserve rich tables, marks and inline attributes. Browser HTML
import now uses extension contributions too; see [HTML parsing](html-parsing.md)
for rules, round-trip behavior and explicit losses. Static export does not infer
parsers from renderers. There is no Markdown codec or complete collaboration-state
codec in this milestone.
