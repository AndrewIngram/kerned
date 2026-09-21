import type { LaidOut } from './engines';
import { boundaries, type Span } from './layout-types';
import { supportsOwnedText } from './owned-text-support';

export type OwnedBlock = { readonly text: string; readonly spans: readonly Readonly<Span>[] };

type Settings = { width: number; size: number };

function validateSettings(settings: Settings) {
  if (
    !(
      settings.width >= 0 &&
      settings.size > 0 &&
      Number.isFinite(settings.width) &&
      Number.isFinite(settings.size)
    )
  )
    throw new Error('Width must be nonnegative and size positive, both finite');
}

function copyBlock(block: OwnedBlock) {
  if (block.text.includes('\n') || !supportsOwnedText(block.text))
    throw new Error('Blocks must be Latin paragraphs or emoji without newlines');
  const stops = new Set(block.spans.length ? boundaries(block.text) : []);

  const spans = block.spans.map((span) => {
    if (!(span.start < span.end && stops.has(span.start) && stops.has(span.end)))
      throw new Error('Formatting must be a nonempty range at grapheme boundaries');

    return { ...span };
  });

  return { text: block.text, spans };
}

// A session owns current block data and caches. Published snapshots own only
// composed geometry. Build replacements before publishing to preserve rollback.
export function createBlockSession<Paragraph>(
  initial: Settings,
  operations: {
    prepare(
      text: string,
      spans: Span[],
      width: number,
      size: number,
      cached?: Paragraph,
    ): Paragraph;
    snapshot(paragraphs: Paragraph[], size: number, started: number): LaidOut;
    validated(text: string): void;
    closed(): void;
  },
) {
  validateSettings(initial);
  let settings = { ...initial };
  let blocks: ReturnType<typeof copyBlock>[] = [];
  let paragraphs: Paragraph[] = [];
  let active = true;

  function ensureActive() {
    if (!active) throw new Error('Document session has been released');
  }

  function publish(values: Paragraph[], size: number, started: number) {
    return operations.snapshot(
      values.length ? values : [operations.prepare('', [], settings.width, size)],
      size,
      started,
    );
  }

  let latest: LaidOut | undefined = publish([], settings.size, performance.now());

  return {
    get blockCount() {
      return blocks.length;
    },
    snapshot(this: void) {
      ensureActive();

      if (!latest) throw new Error('Missing document snapshot');

      return latest;
    },
    splice(
      this: void,
      index: number,
      deleteCount: number,
      inserted: readonly OwnedBlock[],
    ): LaidOut {
      ensureActive();

      if (
        !Number.isInteger(index) ||
        !Number.isInteger(deleteCount) ||
        index < 0 ||
        deleteCount < 0 ||
        index + deleteCount > blocks.length
      )
        throw new Error('Invalid block splice');

      if (!deleteCount && !inserted.length) {
        if (!latest) throw new Error('Missing document snapshot');

        return latest;
      }

      const started = performance.now();

      const additions = inserted.map((block) => {
        const copy = copyBlock(block);
        operations.validated(copy.text);

        return copy;
      });

      const prepared = additions.map((b) =>
        operations.prepare(b.text, b.spans, settings.width, settings.size),
      );

      const next = [
        ...paragraphs.slice(0, index),
        ...prepared,
        ...paragraphs.slice(index + deleteCount),
      ];

      const result = publish(next, settings.size, started);
      blocks = [...blocks.slice(0, index), ...additions, ...blocks.slice(index + deleteCount)];
      paragraphs = next;
      latest = result;

      return result;
    },
    configure(this: void, next: Settings): LaidOut {
      ensureActive();
      validateSettings(next);

      if (next.width === settings.width && next.size === settings.size) {
        if (!latest) throw new Error('Missing document snapshot');

        return latest;
      }

      const started = performance.now();

      const prepared = blocks.map((b, i) =>
        operations.prepare(
          b.text,
          b.spans,
          next.width,
          next.size,
          next.size === settings.size ? paragraphs[i] : undefined,
        ),
      );

      // Empty documents also use the new width for their implicit blank paragraph.
      const result = operations.snapshot(
        prepared.length ? prepared : [operations.prepare('', [], next.width, next.size)],
        next.size,
        started,
      );

      paragraphs = prepared;
      settings = { ...next };
      latest = result;

      return result;
    },
    retained() {
      return paragraphs;
    },
    release(this: void) {
      if (!active) return;
      active = false;
      blocks = [];
      paragraphs = [];
      latest = undefined;
      operations.closed();
    },
  };
}
