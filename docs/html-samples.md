# HTML book samples

Both editor views offer **Warbreaker** and **War and Peace** in the **Sample**
selector. Add `?sample=warbreaker` or `?sample=war-and-peace` to `/editor.html`
or `/extensions.html` to open a book directly.

## War and Peace

The [editor sample](../public/samples/war-and-peace.html) contains the complete
novel by Leo Tolstoy, translated by Louise and Aylmer Maude, from Book One through
the Second Epilogue. It has 562,489 whitespace-delimited words, about 2.9 times
the Warbreaker sample. Its 11,718 blocks include 382 headings: 15 books, two
epilogues and 365 chapters. The 136 footnotes remain beside the passages they
annotate, and all 976 italic passages survive conversion.

The public-domain edition comes from [Project Gutenberg ebook 2600](https://www.gutenberg.org/ebooks/2600).
The untouched download, including its credits, contents and licence, is saved in
[war-and-peace-full.html](../public/samples/war-and-peace-full.html). The editor
sample omits that front matter and uses H2 for books/epilogues and H3 for chapters
so the outline reflects their hierarchy. It preserves the two preformatted
passages as italic paragraphs with line breaks; fixed-column spacing is normalized.

Regenerate the sample from the checked-in source:

```sh
node scripts/convert-war-and-peace.mjs
```

The script parses the source in an inert browser template and validates every
nonempty text block, its order, all non-whitespace novel text and all italic text.
It writes source/output SHA-256 hashes and counts to `war-and-peace.json`.
It requires the installed Playwright Chromium browser. To refresh the original
download explicitly, fetch `https://www.gutenberg.org/ebooks/2600.html.images` into
`public/samples/war-and-peace-full.html`, then rerun the converter.

Run `pnpm run check:war-and-peace` against the production preview on port 5176.
It compares every imported block, heading level and italic passage with the HTML
in Chromium, Firefox and WebKit. It also checks edits during loading, undo,
navigation to the final chapter, editing the last paragraph, narrow reflow,
independent book caches, sample switching and browser Back. The diagnostic editor
gets a direct-loading check too. Results go to `artifacts/war-and-peace-checks.json`.

## Warbreaker

Choose **Warbreaker** from the editor editor's **Sample** selector, or open
`/extensions.html?sample=warbreaker`. The standalone book is served at
`/samples/warbreaker.html`.

The source is the supplied `WarbreakerFull6.1.prc`, by Brandon Sanderson. The
editor sample runs from the Prologue through Ars Arcanum. The complete conversion
is saved separately as `public/samples/warbreaker-full.html`, including the
introduction, rights explanation, acknowledgements, revision notes and excerpts
from other books. Original attribution and rights remain in that full document.

## Reproduce the conversion

```sh
python3 scripts/convert-warbreaker.py /path/to/WarbreakerFull6.1.prc
# Also verify the existing trimmed sample and refresh its metadata:
python3 scripts/convert-warbreaker.py /path/to/WarbreakerFull6.1.prc --sample public/samples/warbreaker.html
```

The script uses Python's standard library. It reads the Palm database records,
decompresses the unencrypted PalmDOC text and decodes Windows-1252 to UTF-8.
It rejects encryption, unsupported compression, record trailers and mismatched
text lengths. It is a converter for this supplied file, not a general ebook
importer.

The output has semantic headings, paragraphs, bold, italic, underline, line
breaks, links, superscript and a table. Empty layout paragraphs, manuscript
indentation, repeated whitespace, legacy font wrappers and pagebreak markers
are removed. Every nonempty source paragraph and heading must match the output
after whitespace normalization, in the same order. A separate comparison checks
all non-whitespace body characters, including table contents.

`public/samples/warbreaker-full.json` records source/output SHA-256 hashes and
counts: 8,619 text blocks, 80 headings and 236,364 whitespace-delimited words.
Running the conversion twice produces identical full HTML. The default output
never overwrites the trimmed sample. With `--sample`, the script verifies that
its paragraphs form an unchanged contiguous section of the full text and writes
the original excerpt metadata. The current editor sample adds the title as H1 and uses H2 for its chapter headings. Its refreshed `warbreaker.json` records 7,313 text blocks, 62 headings and 196,136 words. In the editor, the table's 34 paragraphs in 33 cells belong to one table block, giving 7,280 root blocks. The manifest's source offsets still describe the excerpt without the added title.

## Import boundary

`src/extensions/html.ts` exports `importHtml(html)`. It parses a complete HTML
document or fragment into the demo schema's paragraph and table nodes and reports counts
of structures that the schema simplifies. It uses an inert template and copies
only text and supported marks. Source elements, attributes, event handlers,
scripts and external resources are never attached to the live document.

- Paragraph boundaries and internal line breaks survive.
- Bold, italic and underline survive, including nested combinations. Mark
  ranges expand to whole graphemes when source markup splits a combining sequence.
- Headings import as editable heading nodes. H1–H4 retain their levels; H5/H6
  map to H4. The Blocks menu changes heading levels without changing block
  identity, text, marks or comment ranges.
- Tables retain rows, header cells, captions, column/row spans and formatted
  paragraphs. The editor view renders a semantic DOM table and measures its
  height through the existing block measurement path. At narrow widths, the table
  scrolls horizontally to keep its columns readable.
- Link labels, superscripts and subscripts become ordinary text. Alignment and
  CSS formatting are not imported. Nested tables flatten to text within their
  enclosing cell and are counted in the conversion report.
- Media and active content are skipped. This is a text importer, not an HTML
  renderer or a general HTML sanitizer.

The canonical HTML remains the source of truth for formatting the demo cannot
represent. The importer can be reused for rich paste, but clipboard insertion
still uses the existing plain-text path. This change does not add an HTML export
round trip or arbitrary file-upload controls.

Tables are read-only atomic blocks in this milestone, as selected for the book
sample. Their own text can be selected and copied through the browser; a canvas
selection spanning a table copies its cells as tab-separated text. They have no
cell caret, navigation or editing commands. The core's headless cell-selection
extension remains separate. A future editable table extension would register
row/cell containers and connect their text leaves to canvas selection rather
than editing the current atomic block through property updates.

The book is fetched and parsed before the first editor paint. Its nodes then
enter the existing adaptive chunk loader, starting with 32 blocks. Only incoming
blocks are laid out; offscreen geometry uses the existing retention policy.
The source model remains in memory while the sample is open. Loading metrics
start after fetch/parse and therefore do not measure the entire startup time.
`paused=1` pauses after the first chunk for interaction tests.

Choosing another sample switches documents in place and reuses loaded engine assets.
Each book has its own cached source model. Edits are in memory and are discarded.
Editing never changes the canonical HTML.

## Verify

```sh
pnpm run build
pnpm run preview
pnpm run check:editor-book
pnpm run check:editor-table
pnpm run check:editor
pnpm run check:transactions
```

The book check compares all imported text blocks and underline text with the
HTML in Chromium, Firefox and WebKit. It checks inert parsing, nested marks,
grapheme boundaries, split/join, edits during loading, undo, completion, the last
paragraph, narrow reflow at 150% zoom and sample switching. Results are written
to `artifacts/editor-book-checks.json`; screenshots are saved alongside it.
The table check verifies HTML spans, the book's 11-row/33-cell grid and measured
placement at desktop width and 150% zoom on a narrow viewport in all three browsers.
