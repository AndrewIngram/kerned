# Current editor limitations

Updated 2026-09-22 after the public-interface migration. This is the current
limitations inventory. Earlier studies and milestone logs describe their own
snapshots; their pending-work lists are not the current backlog.

## Editing and rendering

- Text layout supports Latin, Greek, Cyrillic, Arabic, Hebrew, common symbols and
  supported emoji, including bidi visual carets and disjoint selections. Chinese
  canvas layout is available with an opt-in font catalog (the demo includes
  Journey to the West); its regular/bold font assets add about 33.4 MB. Unbreakable directional words overflow rather than
  splitting joined glyphs without reshaping. Vertical writing, script-specific
  italic faces, native-editor parity for mixed-run word shortcuts and IME/device
  validation remain incomplete.
- Rectangular table paste requires an unmerged source and unmerged destination
  cells inside the source-sized paste rectangle. Merged cells elsewhere in the
  destination are preserved, including when the table grows. Copy can retain whole
  merged cells, but rejects rectangles that cut through them.
- Table cells accept installed text-block definitions, not arbitrary lists,
  quotes or embedded blocks. Row/column append commands require unmerged tables;
  merge, split and row/column deletion commands are absent.
- Clipboard fragments are closed valid trees. General fitting of arbitrary open
  fragments into custom containers is not implemented. External HTML round-trips
  require extension serializers and parsers; comments are not exported.
- A session supports one mounted view. React is optional, but React renderer
  registrations need an `EditorContent` host.
- Font catalogs use registered static faces. Variable axes, oblique angles,
  system font discovery and cross-font combining-grapheme fallback are absent.
  Ordered fallback families select whole runs or graphemes by coverage.
  Prepared canvas labels support the same optional family, weight and style as
  text presentations, including live font replacement.

See [clipboard behavior](clipboard.md), [font configuration](view-fonts.md),
[mounted views](mounted-editor.md) and [rendering extensions](rendering-extensions.md).

## Collaboration, references and persistence

- There is no concurrent-operation rebase engine, production sync transport,
  reconnect protocol or collaboration-safe selective undo. The split-versus-insert
  convergence case in `tests/foundation.test.js` remains a TODO, not a reproduced
  local editing failure. The OT/Automerge comparison remains an experiment to do.
- Durable text references require the document's matching position checkpoint.
  Indexed lookup is optimized, but retained mapping metadata still grows with
  edits. There is no bounded compaction scheme that preserves all unknown external
  references. Structural gaps attach to neighboring identities; deleting both
  edges can leave a gap deleted even if unrelated children survive nearby.
- Local history limits the number of groups, not the size of each group.
  Consecutive snapshots within a typing group are coalesced, but mapping metadata,
  separate snapshot runs and deleted content still consume memory. Undo stacks
  are not persisted in the position checkpoint. See [retention measurements](editor-session-retention.md).
- Node permissions and general locks are checked locally. Projection can omit
  protected subtrees, but trusted update delivery, revocation handling, restricted
  reference resolution and protected mark/text semantics remain unfinished.
- Agent text proposals check expected keys/text and the current revision. They
  do not provide general structural conflict resolution or idempotent delivery.
- Versioned document codecs reject unsupported versions and types. Automatic
  schema migration, storage adapters and persistence scheduling are not supplied.
  Bulk document decoding is synchronous; progressive demo ingestion does not
  establish an incremental JSON decoder or a network loading protocol.

See [reference persistence](editor-references.md), [session contracts](editor-session-api.md)
and the separate [foundation/collaboration plan](editor-implementation-plan.md).

## Validation gaps

- The opt-in semantic reading DOM exposes headings, lists and tables, with a
  separate native textarea editing bridge. It is not paginated for large books.
  Mark announcements, cross-block native selection and accurate accessible text
  geometry remain incomplete. VoiceOver, NVDA and real native IME/device testing
  are still required; browser assertions do not establish compatibility.
- The editor consumes touch gestures for selection and uses `touch-action: none`.
  Native-feeling scrolling, selection handles and mobile keyboard behavior need
  device testing. Desktop browser tests do not establish mobile readiness.
- Native spellchecking is disabled on canvas text capture.
- Current performance gates cover the demo workloads. They do not establish
  memory bounds for months of editing, arbitrary structural reference histories,
  extensive permissions or every custom decoration workload.

## Deliberate scope boundaries

Packages are private and unpublished. Applications serve the rendering fonts/WASM
assets or configure asset resolution. Markdown, JSON Schema generation and schema
hot-swapping are deferred. The checklist extension was removed intentionally.

## Recommended next work

Measure sustained typing, undo retention and checkpoint growth together, while
checking references captured at different revisions. Use those results to guide
storage changes without weakening reference durability. Collaboration should
begin with bounded two-client convergence, references and selective-undo cases
before introducing a transport or choosing a permanent backend.
