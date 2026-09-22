# Mixed-direction text in the owned renderer

Research date: 2026-09-22. Status: foundations implemented, not shipped
Arabic/Hebrew support in the mounted editor. The immediate target is mixed Arabic/Hebrew and English,
including visual navigation and selection. Greek/Cyrillic input is a separate,
smaller foundation step.

## Implementation progress

The first implementation lives in `packages/view/src/internal/bidi`. It adapts
the MIT-licensed bidi-js algorithm into typed scalar processing, with generated
Unicode 17.0.0 property ranges, bracket data and explicit UTF-16 position mapping.
There is no new runtime package or serialization boundary. Both complete official
fixture sets pass: 770,241 class/direction cases and 91,707 character cases.
Tests load checksum-verified compressed fixtures locally and need no network.

The existing WASM module now also exports a directional run operation with
surrounding-text context. Real-font tests prove Hebrew combining cluster decoding
and Arabic joining across a split run. Arabic/Hebrew regular and bold font assets
are revision/checksum pinned, but are not yet default registered fallback faces.

The composer accepts retained bidi analysis. Its optional bidi path reorders whole
clusters per line, builds separate logical/visual caret indexes and paints disjoint
selection spans. Pure tests cover mixed runs, soft-wrap affinity, pointer/caret
round trips, visual arrows and full-range selection. Existing LTR callers retain
their packed fast path. The mounted renderer does not yet supply bidi analysis.

Remaining integration work is coverage-based font fallback, directional/script
run itemization across marks and atoms, shaping safety at emergency line breaks,
mounted navigation policies and browser validation. The text-support guard remains
closed for RTL scripts until these are connected. This foundation is not evidence
that Arabic/Hebrew can already be entered in `editor.html`.

The architectural judge reviewed commit `fddf2b0`. The follow-up fixes RTL
horizontal movement across soft wraps, coalesces reordered same-font glyphs into
one drawing run, indexes isolate continuation runs, and avoids scanning selection
spans for collapsed caret queries. Regression cases include 1,000 RTL glyphs,
100,000 digits, and 10,000 nested or sibling isolates. Per-cluster helper closures
were also removed from the unchanged LTR path after a local composition comparison
exposed their cost. These microbenchmarks are not end-to-end editor measurements.

## Recommendation

Keep paragraph analysis, wrapping, visual ordering, caret movement and selection
geometry in TypeScript. Extend the existing HarfRust shaping call to accept
directional/script/font runs. Do not add another layout engine, worker round trip,
JSON representation or runtime solely for bidirectional text.

Own a small private bidi module with generated, versioned Unicode property tables.
An audited port of an existing permissively licensed algorithm is a reasonable
starting point; buying into its tests and maintenance obligations matters more
than whether it appears in `package.json`. Gate it on the official conformance
fixtures before enabling mixed-direction input. Preserve the current compact LTR
path where its invariants actually hold.

## What currently prevents this

These are findings from repository source, independent of the external references:

| Location                                        | Assumption that must change                                                                                                                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `native-owned/src/lib.rs`, `shape`              | Guesses segment properties, then unconditionally sets left-to-right direction. The packed result omits shaping safety flags and run metadata.                                                            |
| `packages/view/src/internal/owned-layout.ts`    | Splits style and emoji runs without paragraph bidi/script analysis or surrounding shaping context. Input is encoded and copied to the existing WASM heap; results borrow its memory until the next call. |
| `packages/view/src/internal/owned-shaped.ts`    | Derives a cluster's logical end from the next glyph cluster, assuming ascending cluster offsets.                                                                                                         |
| `packages/view/src/internal/owned-inline.ts`    | Repeats that ascending-cluster assumption and treats atom-separated segments independently.                                                                                                              |
| `packages/view/src/internal/owned-paragraph.ts` | Wraps and paints clusters in one order, emitting increasing offsets at increasing x positions.                                                                                                           |
| `packages/view/src/internal/owned-carets.ts`    | Binary-searches one set of stops by both logical offset and visual x. Emits at most one selection rectangle per line.                                                                                    |
| `packages/view/src/internal/layout-types.ts`    | A position contains only `index` and `upstream`; current affinity mainly distinguishes a soft-wrap edge.                                                                                                 |
| `packages/view/src/canvas/font-catalog.ts`      | Selects family/style/weight plus a special emoji face, without text-coverage fallback.                                                                                                                   |

Changing the script allowlist or reversing a paragraph cannot repair these
assumptions. HarfBuzz explicitly leaves bidi processing, line breaking and font
fallback to its caller. It shapes runs, not complete mixed-direction paragraphs.
[HarfBuzz scope](https://harfbuzz.github.io/what-harfbuzz-doesnt-do.html)

## Standards and implementation candidates

UAX #9 resolves levels per paragraph and reorders each line after line breaking.
Its rules cover numbers, neutral punctuation, paired brackets, isolates and
explicit formatting controls. Logical document order remains unchanged.
Its conformance section specifies `BidiTest.txt` and `BidiCharacterTest.txt`.
The current published report identifies Unicode 18.0.0, revision 52.
[UAX #9](https://www.unicode.org/reports/tr9/tr9-52.html)

HarfBuzz buffers need direction, script and language. The pinned HarfRust 0.3.2
already exposes setters for those values and for pre/post context and cluster
level. It also exposes `GlyphInfo.unsafe_to_break()`; our wrapper currently drops
that information. An upstream upgrade is therefore not a prerequisite for this
first implementation.
[Buffer properties](https://harfbuzz.github.io/setting-buffer-properties.html),
[HarfRust 0.3.2 UnicodeBuffer](https://docs.rs/harfrust/0.3.2/harfrust/struct.UnicodeBuffer.html),
[HarfRust 0.3.2 GlyphInfo](https://docs.rs/harfrust/0.3.2/harfrust/struct.GlyphInfo.html)

| Candidate                                      | Evidence                                                                                                                                                                                              | Assessment for this repository                                                                                                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vendored/adapted `bidi-js`                     | MIT; numeric embedding levels and per-line reorder operations. Its README claims Unicode 13 conformance. Its current source classifies `string[i]`, requiring scrutiny for supplementary code points. | Useful compact starting point, not something to accept unchanged as current Unicode support. Port to our offset conventions, generate current data, retain attribution, and run both full fixture sets.    |
| Owned TS implementation from the specification | No runtime dependency; fits our typed-array pipeline.                                                                                                                                                 | Largest initial correctness burden. Only reasonable with the same conformance gates and differential tests; no simplified Arabic/Hebrew heuristic.                                                         |
| Servo `unicode-bidi` in existing WASM          | MIT or Apache-2.0; Rust bidi implementation with its own conformance test target.                                                                                                                     | Credible reference/oracle and fallback option if the TS implementation fails its gates. Would add no second WASM instance, but would move bidi ownership out of TS and enlarge the native result contract. |

Candidate sources:
[bidi-js README](https://github.com/lojjic/bidi-js/blob/main/README.md),
[bidi-js implementation](https://github.com/lojjic/bidi-js/blob/main/src/embeddingLevels.js),
[bidi-js license](https://github.com/lojjic/bidi-js/blob/main/LICENSE.txt),
[unicode-bidi manifest](https://github.com/servo/unicode-bidi/blob/main/Cargo.toml).
The inspected `bidi-js` manifest declares `require-from-string` despite the
README's dependency-free statement; vendoring selected source avoids inheriting
its packaging arrangement. No claim of recent maintenance cadence is made here.

The comparison is an architectural recommendation, not a measured performance
result. Existing WASM shaping already incurs UTF-8 encoding and a copy. TS bidi
does not eliminate that cost, but it need not introduce an additional one.

## Private data model and ownership

Keep UTF-16 offsets at the editor interface. Analyze Unicode scalar values with
an explicit scalar-to-UTF-16 map; never interpret a surrogate half as a character.
Generated tables must include default property ranges for unassigned characters,
not just entries copied from `UnicodeData.txt`.
[DerivedBidiClass 17.0.0](https://www.unicode.org/Public/17.0.0/ucd/extracted/DerivedBidiClass.txt)

The proposed private seam is paragraph analysis plus per-line ordering:

- Paragraph analysis returns base direction, resolved levels and logical run
  boundaries. It is retained with immutable paragraph shaping and invalidated by
  text/direction changes, not viewport scrolling.
- Run itemization intersects bidi level, resolved script, font and formatting.
  Common/inherited characters take contextual script handling rather than making
  a separate run for every space or combining mark. Atom placeholders participate
  in the paragraph's analysis, while their labels shape independently.
- Shaping accepts logical text and explicit run properties through the existing
  packed protocol. Supply adjacent context when a formatting/font boundary cuts
  joining text. Do not reverse source strings or mirror them twice.
- Cluster storage is ordered logically; each cluster retains its glyph slice in
  the shaper's output order. Compute ends from sorted logical starts plus the run
  end. RTL glyph output must not define decreasing logical ranges.
- Composition chooses logical line breaks, then produces a visual permutation of
  clusters/runs for each line. Width-only reflow reuses paragraph analysis and
  safe shaping, but recalculates line ordering and caret geometry.

HarfBuzz's monotonic cluster guarantees depend on direction: RTL output can have
decreasing cluster values. Cluster values identify text associations, not an
instruction to sort glyphs individually. Keep glyphs within a cluster together.
[HarfBuzz clusters](https://harfbuzz.github.io/working-with-harfbuzz-clusters.html)

Wrapping across a joining sequence may require reshaping the affected line edge.
Expose shaping safety information and test this explicitly; the current emergency
break between any clusters cannot be assumed safe for Arabic. Use beginning/end
flags and context with their actual text semantics. This is a targeted extension
of shaping, not a reason to move all composition into WASM.

The first public presentation change should be a text direction policy
`auto | ltr | rtl`, distinct from alignment. Derive authored direction/language
from extension attributes where persistence is wanted, rather than adding
paragraph names to core. Automatic direction alone cannot represent an intended
RTL empty paragraph or an RTL paragraph beginning with a Latin product name.
Apply the same resolved direction to native table input and accessible text.

## Carets, selection and interaction

Introduce an explicit distinction between logical position and visual stop. A
visual stop carries logical offset, line, x and run-side association. Maintain
an x-ordered per-line index for hit testing and a logical-offset index for mapping
selection to geometry. Packed arrays remain suitable, but a single sort order
cannot serve both indexes.

Specify a deterministic primary caret and preserve the chosen visual side at a
direction transition. Audit whether the existing `upstream` bit can express all
needed soft-wrap and bidi associations; do not silently overload it. Keep any
visual tie-break state in the view unless a semantic selection contract requires
it. Durable references stay logical and independent of wrapping or font choice.

Recommended interaction contract, to validate against native controls on each
target platform:

- Left/right traverse visual stops; up/down retain preferred x.
- Shift preserves the logical anchor while moving the visual focus. A logically
  continuous selection can cover disjoint visual intervals on one line.
- Home/end and platform modifier shortcuts follow an explicit platform policy;
  logical word motion and physical arrow direction must not be conflated.
- Backspace/delete retain documented logical grapheme deletion semantics, with
  separate tests at direction transitions. Arrow implementation must not redefine
  deletion by accident.
- Selection painting intersects the logical range with visual runs and merges
  only adjacent painted intervals. Apply the same geometry to search, comments,
  mark decorations and inline overlays.
- Clipboard, transactions, search and durable references use logical text order.
  Hit testing must round-trip through caret geometry, including both visual sides
  of an ambiguous offset and soft wraps.

These are proposed editor policies. UAX #9 specifies display ordering, not a
complete keyboard interaction contract.

## Fonts and fallback

Start with pinned Noto Sans Arabic and Noto Sans Hebrew assets, normal and bold,
registered through the existing configurable font catalog. Their upstream projects
include SIL Open Font License files. Record exact revisions/checksums and retain
their notices; do not download fonts dynamically from an unversioned URL at edit
time.
[Noto Arabic](https://github.com/notofonts/arabic),
[Arabic OFL](https://github.com/notofonts/arabic/blob/main/OFL.txt),
[Noto Hebrew](https://github.com/notofonts/hebrew),
[Hebrew OFL](https://github.com/notofonts/hebrew/blob/main/OFL.txt)

Extend font configuration with an ordered fallback-family policy. Cache coverage
at registration or first use, choose a face for a whole grapheme where possible,
and retry missing-glyph runs rather than routing every Arabic code point blindly.
Keep existing emoji/variation-selector behavior. Joined script sequences may need
fallback as a larger run to preserve their shaping. Use real available styles;
do not promise italic variants or synthetic slant that are not implemented.

Readiness must cover fallback fonts required by initial content; subsequent
loading must use the existing font invalidation and visible reflow machinery.
Measure extra asset bytes and startup cost separately from shaping throughput.
Browser-native and canvas text must use matching faces and direction policies.

## Implementation stages and acceptance gates

1. **Pin data and prove paragraph analysis.** Commit a reproducible table/fixture
   generator, source URLs, Unicode version, checksums and notices. Implement scalar
   indexing, levels and per-line ordering privately. Run both complete official
   bidi fixture files, including isolates, brackets, supplementary characters and
   overflow-depth cases. Keep the script guard closed until the pipeline is ready.
2. **Directional shaping and fallback.** Extend the existing native call and
   decode path; add Arabic/Hebrew fonts and context-aware itemization. Compare
   glyph IDs/advances against a pinned HarfRust/HarfBuzz reference with identical
   fonts. Include Arabic joining across formatting boundaries, Hebrew marks,
   Arabic/European digits, emoji and atom neighbors.
3. **Composition and geometry.** Add line permutations, contextual emergency
   wrapping, visual stop indexes and disjoint selection rectangles. Run pure tests
   over packed/object representations and real browser tests at narrow/wide widths,
   zoom and live font replacement. Retain Latin geometry/performance comparisons.
4. **Mounted editor behavior.** Enable supported scripts and test pointer, drag,
   double-click, arrows/modifiers, page motion, composition, copy/paste, undo,
   cross-block ranges, tables, search and comments in all three browser engines.
   Add a mixed Arabic/Hebrew/English sample to the accessibility test matrix.
5. **Regression budgets and documentation.** Measure first render, long-document
   loading, typing in a mixed paragraph, paragraph resize, retained bytes and
   shaping-call counts. Report UAX version and unsupported scripts explicitly.

The implementation pins Unicode 17.0.0 for algorithm expectations, generated
tables and fixtures. Regenerate with `node scripts/generate-bidi-data.mjs`, or pass
a directory containing the four original UCD files for offline regeneration.
Source hashes are in `bidi/unicode-sources.json`; both Unicode and bidi-js license
notices are retained and copied into built packages. The generator verifies
downloaded bytes before writing results. Routine tests use committed fixtures.

Full international editing still includes work beyond this target: Indic and
Southeast Asian shaping/line breaking, dictionary segmentation, CJK typography,
vertical text and broader input-method/device testing. Supporting Arabic/Hebrew
must not be described as supporting every Unicode script.
