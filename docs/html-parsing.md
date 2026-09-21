# HTML parsing

HTML import is a browser capability, separate from static export and interactive
rendering. `createHtmlParser(schema, rules)` works without an editor session or a
mounted view. `createEditorHtmlParser(editor)` collects the session's
`htmlParsers` contributions. The starter browser input extension installs its
parsers and uses that collection for external HTML paste.

An extension can pair a static serializer with a parser:

```ts
context.provide(
  htmlParsers,
  defineHtmlTextParser(callout, {
    selector: 'aside[data-tone]',
    attributes: (element, text) => ({
      text,
      tone: element?.getAttribute('data-tone') ?? 'info',
    }),
  }),
);
```

The callback's attribute type comes from the definition's input Standard Schema.
The parser binds the installed definition family, including configured options,
and validates construction through that binding. Text, mark ranges and inline
objects are stored using the definition's configured fields. Extension authors
need not know their raw storage shape.

## Rules and precedence

- `defineHtmlTextParser` creates text nodes. Exactly one installed text rule must
  set `fallback: true`; it wraps text found outside a recognized block. The
  callback receives `null` for its element in that case.
- `defineHtmlNodeParser` creates atoms or containers. Containers parse child
  blocks recursively. Return `false` from its attribute callback to decline a
  match. Container child constraints still apply; schema-specific repair belongs
  in the extension.
- `defineHtmlValueParser` creates either marks or inline objects, according to
  the definition. Return `false` to decline. `null` remains a valid attribute
  value for attribute-free marks. Inline objects replace their source subtree
  with a single object position and retain validated attributes.
- `HtmlParserContribution.create(context)` supports structures such as tables.
  Return a node rule whose `parse(element)` uses `context.schema`,
  `context.allocate()`, `context.blocks(element)` and `context.text(element)`.
  `null` declines; an empty array consumes the element without producing nodes.
  The starter table parser owns rows, cells, spans and nested-table conversion.

Higher numeric `priority` runs first, with installation order breaking ties.
The first accepted node or inline rule consumes its element. Marks of different
types compose; the highest-priority accepted rule for each type wins on the same
element. Inner elements can override inherited values of that mark type.

Unknown wrappers retain text. Unknown HTML block elements separate fallback
blocks. Paragraphs containing block atoms split around those atoms. ASCII HTML
whitespace collapses, explicit line breaks survive, and mark boundaries expand
to whole graphemes. Raw object-replacement characters without an inline parser
become replacement characters instead of invalid inline positions.

## Ownership and validation

`parse(html)` creates an inert template; it never attaches source DOM to the
view. Executable/resource subtrees such as scripts, styles and iframes are
ignored before rules run. Each import allocates fresh local identities and
validates the resulting tree. Paste subsequently copies the fragment into the
session's identity space. Parser recursion is bounded; validation failures throw
without changing the editor. The input adapter reports them through its normal
notice path.

`parseElement(parent)` reads an existing DOM subtree using the same rules. It
does not clone or attach the subtree. This is useful for diagnostics that already
parsed HTML. Extension callbacks are trusted code and own URL/attribute policy.
The starter image rule accepts HTTP(S) and relative sources, discarding event
handlers and unrelated attributes. It does not fetch an image during parsing.

The public model bindings also support constructing rich content directly:

```ts
const mark = schema.value(link).create({ href: '/guide' });
const node = schema.node(paragraph).create(
  identity,
  { text: 'Read this' },
  {
    marks: [{ from: 0, to: 9, mark }],
  },
);
```

For inline values, combine `schema.value(definition).create(attributes)` with an
`id` and `index` in the supplied `inline` array. A corresponding object character
must exist in the text. Constructors validate bounds, graphemes, allowed types
and attributes, own their arrays, and freeze canonical values. Attribute
normalization may not move supplied text offsets.

## Round trips and limits

Starter HTML round trips preserve heading levels, lists, quotes, table row/cell
structure and spans, marks, images and mention attributes. Mention dimensions
are explicit interchange metadata; they are not inferred from imported DOM.
Nested tables become text inside a cell because the starter cell schema permits
text blocks only. Unknown custom markup loses its schema semantics unless its
extension supplies a parser. Unsupported image schemes are dropped.

HTML import allocates new identities and does not restore locks, history,
permissions, durable reference checkpoints or collaboration state. Use the
versioned JSON content codec for document persistence. Static HTML/text export
remains usable in Node without a DOM; HTML parsing requires browser DOM APIs.
