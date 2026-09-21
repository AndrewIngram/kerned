import { sampleChunk } from './editor-stream';
import { plainText, createSampleDocument, type StarterNode } from './extensions/demo-model';
import { demoSchema } from './extensions/demo-schema';
import { formattingMarks } from './extensions/formatting';
import { importHtml } from './extensions/html';
import { createOutlineExtension, type OutlineEntry } from './extensions/outline';

type BookSampleId = 'warbreaker' | 'war-and-peace';

export const bookSamples: readonly { id: BookSampleId; title: string; description: string }[] = [
  {
    id: 'warbreaker',
    title: 'Warbreaker',
    description: 'Brandon Sanderson · Version 6.1 · Prologue through Ars Arcanum',
  },
  {
    id: 'war-and-peace',
    title: 'War and Peace',
    description: 'Leo Tolstoy · Translated by Louise and Aylmer Maude · Complete novel',
  },
];

export type EditorSample = {
  id: 'extensions' | 'stream' | 'minimal' | BookSampleId;
  title: string;
  description: string;
  total: number;
  initial: StarterNode[];
  comments?: (
    nodes: readonly StarterNode[],
  ) => { id: string; nodeId: number; from: number; to: number; body: string }[];
  outline?: readonly { entry: OutlineEntry; sourceIndex: number }[];
  chunk: (start: number, count: number) => StarterNode[];
};

const books = new Map<BookSampleId, Promise<StarterNode[]>>();

export async function loadEditorSample(url = new URL(location.href)): Promise<EditorSample> {
  const book = bookSamples.find((book) => book.id === url.searchParams.get('sample'));

  if (book) {
    let loaded = books.get(book.id);

    if (!loaded) {
      loaded = (async () => {
        const response = await fetch(`/samples/${book.id}.html`);

        if (!response.ok) throw new Error(`Could not load ${book.title} (${response.status})`);
        const { nodes } = importHtml(await response.text());

        if (!nodes.length) throw new Error(`${book.title} contains no importable text`);

        return nodes;
      })().catch((error) => {
        books.delete(book.id);
        throw error;
      });
      books.set(book.id, loaded);
    }

    const nodes = await loaded;
    // Only the current chunk enters editor state and paragraph layout. The
    // decoded HTML/model is downloaded and parsed once before the first paint.
    const chunk = (start: number, count: number) => nodes.slice(start, start + count);

    const extractor = createOutlineExtension(demoSchema, (node) =>
      node.kind === 'heading' ? { level: node.level, title: plainText(node) } : null,
    );

    const outline = nodes.flatMap((node, sourceIndex) =>
      extractor.read([node]).map((entry) => ({ entry, sourceIndex })),
    );

    return { ...book, outline, total: nodes.length, initial: chunk(0, 32), chunk };
  }

  const total = Number(url.searchParams.get('stream'));

  if (Number.isInteger(total) && total >= 32 && total <= 10000)
    return {
      id: 'stream',
      comments: sampleComments,
      title: 'Mixed blocks',
      description: 'Generated paragraphs, mentions, a table and images.',
      total,
      initial: sampleChunk(0, 32),
      chunk: sampleChunk,
    };

  if (location.pathname === '/editor.html') {
    const texts = [
      'Good ideas often begin with a few words. A thought worth keeping, a question to explore, or a plan taking shape.',
      'Give the important parts some emphasis, leave room for another perspective, and keep going.',
      'The best tools give your ideas room to breathe.',
      'Try selecting a few words, or a passage across paragraphs. Make it bold or italic, rewrite it, and undo to find your way back.',
    ];

    const initial: StarterNode[] = texts.map((text, index) => ({
      kind: 'paragraph',
      id: index + 1,
      key: `draft-${index + 1}`,
      text,
      marks: [],
      inline: [],
    }));

    const second = initial[1];

    if (second.kind === 'paragraph' || second.kind === 'heading')
      initial[1] = {
        ...second,
        marks: formattingMarks([
          { start: 25, end: 38, bold: true, italic: false },
          { start: 54, end: 73, bold: false, italic: true },
        ]),
      };

    return { id: 'minimal', title: 'Draft', description: '', total: 0, initial, chunk: () => [] };
  }

  return {
    id: 'extensions',
    comments: sampleComments,
    title: 'Launch notes',
    description: 'Select a mention or highlighted phrase. Edit the table to add notes.',
    total: 0,
    initial: createSampleDocument(),
    chunk: () => [],
  };
}

export function sampleUrl(id: string) {
  const url = new URL(location.href);

  for (const key of ['sample', 'stream', 'paused', 'slowImages']) url.searchParams.delete(key);

  if (bookSamples.some((book) => book.id === id)) url.searchParams.set('sample', id);

  if (id === 'stream') url.searchParams.set('stream', '10000');

  return url.href;
}

function sampleComments(nodes: readonly StarterNode[]) {
  return nodes.flatMap((node) => {
    if (node.kind !== 'paragraph' && node.kind !== 'heading') return [];

    if (node.id === 2)
      return [
        {
          id: 'review',
          nodeId: 2,
          from: 10,
          to: 40,
          body: 'Can we limit this to the core editing flow?',
        },
      ];
    const index = node.id - 10;

    return index >= 0 &&
      index % 20 === 9 &&
      node.text.includes('styled') &&
      node.text.includes('feedback')
      ? [
          {
            id: `comment-${index}`,
            nodeId: node.id,
            from: node.text.indexOf('styled'),
            to: node.text.indexOf('feedback') + 8,
            body: '',
          },
        ]
      : [];
  });
}
