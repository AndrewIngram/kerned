# Retained layout pipeline

## Caller contract

The caller supplies document/block identity, text, style spans, width and size. It receives an immutable layout snapshot with hit testing, selection, navigation and drawing. Updating an existing identity publishes a new snapshot only after all required work succeeds. Releasing an identity drops retained data; already returned snapshots remain valid.

The current `Engine.layout(input)` interface remains the comparison adapter. It supplies whole text and therefore still requires scanning for paragraph changes. A future editor-facing API should deliver changed blocks with stable ids and revisions. That is a separate step, not an optimization claimed by this slice.

## Retained data

1. **Shaped paragraph:** paragraph-local UTF-16 cluster offsets, glyph ids, advances, offsets, font ids, grapheme stops and legal line-break opportunities. Its identity depends on text, styles, font configuration and size, not width or document position.
2. **Composed paragraph:** width-dependent lines, local caret stops and prepared glyph/position buffers. It references shaped text and stores every position relative to its paragraph origin. A changed predecessor cannot invalidate these positions.
3. **Placed paragraph:** a composed paragraph reference plus its current document text offset and vertical origin. Moving a paragraph changes its placement, not its internal geometry or glyph buffers.
4. **Document snapshot:** ordered placements and indexes for translating document offsets and y coordinates to paragraph-local coordinates. The snapshot owns references, not duplicate glyph/caret arrays.

A text/style change invalidates the affected shaped paragraph and its composition. Width changes invalidate composition while retaining shaping. A paragraph insertion, deletion or reorder updates placements and reuses unchanged paragraphs. Caret movement, hit testing and selection read retained geometry without shaping, line composition or render-buffer creation.

Only the current composition width is retained per paragraph variant in a document. A prior snapshot may retain an older width until the snapshot is released by its caller. This avoids unbounded caching of historical widths while preserving snapshot immutability.

## Execution alternatives

| | Retained TypeScript layout | Co-located Rust/WASM layout |
|---|---|---|
| Persistent owner | Our JS document store | Our WASM document store |
| Shaping | Changed text goes through our binary HarfRust adapter | Native call inside the same module |
| Composition and interaction | Direct access to retained JS data | Native access to retained WASM data |
| Boundary on edit | UTF-8 input copy and shaped output copy | Edit command input; changed render output and interaction results |
| Boundary on resize | None for shaping or composition | Resize command and changed render output |
| Renderer | Reads prepared JS typed arrays | Reads WASM buffers or copies/transfers published buffers |
| Main cost/risk | JS allocations, GC and the changed-text shaping boundary | Buffer lifetime across memory growth, handle ownership, renderer access and more migration |

The chosen and implemented first slice retains composition and render buffers in TypeScript. This tests whether eliminating repeated work is sufficient before paying for a language/runtime migration. It does not claim this boundary is optimal. The alternative keeps the same paragraph-local model, allowing a later port without changing invalidation semantics.

A worker is an execution host for either design. It should own the complete mutable document store, accept ordered revision-tagged changes, and publish immutable render results. Main-thread code must not synchronously query the worker for each caret movement. Interaction either uses a published geometry snapshot or is processed alongside input in the owning runtime. No worker, shared-memory protocol or revision transport is implemented in this slice.

## Modules and boundary costs

- `native-owned/src/lib.rs`: font registration, HarfRust shaping and Unicode line-break opportunities. It still uses an input allocation and a synchronous binary result buffer.
- `src/owned-layout.ts`: document retention, shaping adapter and CanvasKit drawing adapter.
- `src/owned-paragraph.ts`: owns wrapping, local caret geometry and prepared render buffers. No external layout calls are allowed from these operations.
- `src/owned-document.ts`: translates between local and document coordinates and owns placement indexes.

The changed-text path still calls `Intl.Segmenter`, copies text into WASM and expands shape results into JS objects. CanvasKit still receives glyph buffers to draw and may copy them into its own WASM memory. Prepared buffers remove repeated JS reconstruction; this is not a zero-copy renderer.

## Invariants and verification

- Editing one of 500 unique paragraphs at unchanged width shapes and composes only that paragraph.
- Width changes compose each affected paragraph but never shape unchanged text.
- Unchanged layout and interaction queries perform zero shaping, composition or render-buffer builds.
- Moving paragraphs changes only placement, including text offsets after insertion/deletion and y positions after a predecessor changes height.
- Warm/reused snapshots match a fresh layout for lines, hit testing, navigation and selection.
- Failed layout does not publish partial state or modify any earlier snapshot.
- Removing a document releases its retained references. Memory remains proportional to retained content and snapshots; viewport eviction and byte budgets are not implemented.

Counters for shaping, composition and render-buffer creation must accompany timings. The existing median/p95 workloads remain the baseline; paint cost needs separate measurement because drawing per-paragraph buffers changes draw-call granularity.

## Typed-array experiment

The default remains object-backed shaping with retained paragraph geometry. An opt-in `createOwnedEngine(kit, 'packed')` path prepares a structure-of-arrays glyph view and writes render positions directly into typed arrays during composition. It uses scalar JavaScript, adds no transport boundary, and retains Float64 arithmetic inputs. It is experimental because timing gains vary and the prepared view currently adds storage alongside shaped objects. See [size validation and measurements](owned-size-validation.md).

## Packed caret experiment

An independent `carets` option replaces per-stop objects and offset maps with ordered typed arrays in one paragraph-owned buffer. It leaves glyph storage unchanged. It passes the expanded equivalence/lifetime sweep and reduces sampled allocations, with a tradeoff between direct offset lookup and horizontal navigation. It remains opt-in; see [the paired measurements](owned-carets.md).
