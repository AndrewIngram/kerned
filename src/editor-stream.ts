import { createSampleDocument, type StarterNode } from './extensions/demo-model';
import { formattingMarks } from './extensions/formatting';
import { createMention } from './extensions/mention';

const params = new URLSearchParams(location.search);

const requested = Number(params.get('stream'));

export const streamConfig = {
  total: Number.isInteger(requested) && requested >= 32 && requested <= 10000 ? requested : 0,
  paused: params.get('paused') === '1',
  imageDelay: params.get('slowImages') === '1' ? 1600 : 250,
};

const introduction = createSampleDocument().slice(0, 4);

const imageSource =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="360" viewBox="0 0 800 360"><rect width="800" height="360" fill="#e5edda"/><path d="M60 270L220 140L340 230L510 75L730 270Z" fill="#78936b"/><circle cx="650" cy="85" r="32" fill="#edc968"/></svg>',
  );

/** A deterministic local source. Only the requested chunk is generated. No network timing is implied. */
export function sampleChunk(start: number, count: number): StarterNode[] {
  return Array.from({ length: count }, (_, offset): StarterNode => {
    const index = start + offset;

    if (index < 4) return introduction[index];

    const i = index - 4,
      id = index + 6;

    if (i % 20 === 0)
      return {
        kind: 'checklist',
        id,
        key: `block-${id}`,
        checked: [false, false, false],
        expanded: false,
        notes: '',
      };

    if (i % 20 === 4)
      return {
        kind: 'image',
        id,
        key: `block-${id}`,
        src: imageSource,
        alt: `Landscape illustration for section ${index}`,
      };
    const mention = i % 20 === 7;
    const text = `Section ${index}. Review the styled draft${mention ? ' with \ufffc' : ''} and gather feedback. Keep the editing flow responsive while more document blocks arrive.`;

    const bold = text.indexOf('styled'),
      italic = text.indexOf('feedback');

    return {
      kind: 'paragraph',
      id,
      key: `block-${id}`,
      text,
      marks: formattingMarks([
        { start: bold, end: bold + 12, bold: true, italic: false },
        { start: italic, end: italic + 8, bold: false, italic: true },
      ]),
      inline: mention
        ? [
            createMention({
              id: `mention-${id}`,
              index: text.indexOf('\ufffc'),
              width: 132,
              ascent: 23,
              descent: 7,
              label: '@Maya Chen',
            }),
          ]
        : [],
    };
  });
}

export type LoadSample = {
  loaded: number;
  count: number;
  workMs: number;
  elapsedMs: number;
  layouts: number;
};

export type ReflowSample = {
  generation: number;
  width: number;
  blocks: number;
  started: number;
  firstPaintMs: number;
  completeMs: number;
  initialLayouts: number;
  batches: { workMs: number; layouts: number; background: number; pending: number }[];
};

export function createStreamMetrics() {
  const reflows: ReflowSample[] = [];

  const widthChanges: { blocks: number; workMs: number }[] = [],
    editPaintMs: number[] = [];

  const samples: LoadSample[] = [],
    frames: { at: number; gapMs: number }[] = [],
    paints: number[] = [],
    lastLayoutIds: number[] = [];

  return {
    firstCanvasFlushMs: 0,
    firstLoaded: 0,
    startedAt: performance.now(),
    completedAt: 0,
    samples,
    frames,
    widthChanges,
    editPaintMs,
    reflows,
    stalePaints: 0,
    paints,
    maxMounted: 0,
    maxSubmitted: 0,
    layoutCalls: 0,
    compositionMs: 0,
    lastLayoutIds,
    lastSceneMs: 0,
  };
}
