import { boundaries } from '../model';
import type {
  HeadingLevel,
  TextBlockNode,
  StarterSpan,
  StarterNode,
  TableCell,
} from './demo-model';
import { demoSchema } from './demo-schema';
import { formattingMarks } from './formatting';
import { tablePlainText } from './table';

const blocks = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'MAIN',
  'HEADER',
  'FOOTER',
  'ASIDE',
  'NAV',
  'BLOCKQUOTE',
  'UL',
  'OL',
  'LI',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'PRE',
  'HR',
]);

const ignored = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'NOSCRIPT',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'SVG',
  'MATH',
  'IMG',
  'VIDEO',
  'AUDIO',
  'SOURCE',
  'LINK',
  'META',
  'TITLE',
  'BASE',
]);

type Marks = { bold: boolean; italic: boolean; underline: boolean };

export type HtmlImport = {
  nodes: StarterNode[];
  tables: number;
  conversions: {
    headings: number;
    links: number;
    superscripts: number;
    subscripts: number;
    nestedTables: number;
  };
};

/** Parse in an inert template; only text and supported marks enter the model.
 * No source elements, attributes, event handlers or resources reach the live DOM.
 * The same boundary can be used by a future rich-paste transaction adapter.
 */
export function importHtml(html: string): HtmlImport {
  const template = document.createElement('template');
  template.innerHTML = html;
  const nodes: StarterNode[] = [];
  const conversions = { headings: 0, links: 0, superscripts: 0, subscripts: 0, nestedTables: 0 };

  let tables = 0,
    nextId = 1;

  let text = '',
    spans: StarterSpan[] = [],
    headingLevel: HeadingLevel | undefined;

  function append(value: string, marks: Marks) {
    value = value.replace(/[\t\r\n\f ]+/g, ' ');

    if (!text || /[ \n]$/.test(text)) value = value.replace(/^ /, '');

    if (!value) return;
    const start = text.length;
    text += value;

    if (marks.bold || marks.italic || marks.underline) {
      const last = spans.at(-1);

      if (
        last &&
        last.end === start &&
        last.bold === marks.bold &&
        last.italic === marks.italic &&
        !!last.underline === marks.underline
      )
        last.end = text.length;
      else {
        const span: StarterSpan = {
          start,
          end: text.length,
          bold: marks.bold,
          italic: marks.italic,
        };

        if (marks.underline) span.underline = true;
        spans.push(span);
      }
    }
  }

  function flush(force = false) {
    text = text.trimEnd();

    if (text || force) {
      // Inline markup can divide a combining sequence; the editor styles whole graphemes.
      const stops = spans.length ? boundaries(text) : [];
      const starts = new Map(stops.map((offset, index) => [offset, index]));

      function snap(offset: number, up: boolean) {
        if (starts.has(offset)) return offset;

        let lo = 0,
          hi = stops.length;

        while (lo < hi) {
          const mid = (lo + hi) >>> 1;

          if (stops[mid] < offset) lo = mid + 1;
          else hi = mid;
        }

        return stops[up ? lo : lo - 1] ?? text.length;
      }

      const id = nextId++;
      nodes.push({
        ...(headingLevel ? { kind: 'heading', level: headingLevel } : { kind: 'paragraph' }),
        id,
        key: `html-${id}`,
        text,
        marks: formattingMarks(
          spans
            .filter((s) => s.start < text.length)
            .map((s) => ({
              ...s,
              start: snap(s.start, false),
              end: snap(Math.min(s.end, text.length), true),
            })),
        ),
        inline: [],
      });
    }

    text = '';
    spans = [];
  }

  function visit(node: Node, marks: Marks) {
    if (node.nodeType === Node.TEXT_NODE) {
      append(node.textContent ?? '', marks);

      return;
    }

    if (!(node instanceof Element)) return;
    const tag = node.tagName.toUpperCase();

    if (ignored.has(tag)) return;

    if (['BLOCKQUOTE', 'UL', 'OL', 'LI'].includes(tag)) {
      flush();
      const imported = importHtml(node.innerHTML);

      function reidentify(child: StarterNode): StarterNode {
        const children = demoSchema.children(child),
          id = nextId++,
          copy = { ...child, id, key: `html-${id}` };

        return children.length ? demoSchema.withChildren(copy, children.map(reidentify)) : copy;
      }

      let children = imported.nodes.map(reidentify);

      if (!children.length) {
        const id = nextId++;
        children = [{ kind: 'paragraph', id, key: `html-${id}`, text: '', marks: [], inline: [] }];
      }

      if (tag === 'UL' || tag === 'OL')
        children = children.map((child) => {
          if (child.kind === 'listItem') return child;
          const id = nextId++;

          return demoSchema.withChildren(
            { kind: 'listItem', id, key: `html-${id}`, children: [] },
            [child],
          );
        });

      const id = nextId++,
        identity = { id, key: `html-${id}` };

      const start = Number(node.getAttribute('start') ?? 1);

      const container: StarterNode =
        tag === 'BLOCKQUOTE'
          ? { kind: 'quote', ...identity, children: [] }
          : tag === 'LI'
            ? { kind: 'listItem', ...identity, children: [] }
            : {
                kind: 'list',
                ...identity,
                ordered: tag === 'OL',
                start: Number.isSafeInteger(start) && start > 0 ? start : 1,
                children: [],
              };

      nodes.push(demoSchema.withChildren(container, children));
      tables += imported.tables;

      for (const key of [
        'headings',
        'links',
        'superscripts',
        'subscripts',
        'nestedTables',
      ] as const)
        conversions[key] += imported.conversions[key];

      return;
    }

    if (node instanceof HTMLTableElement) {
      flush();

      const rows = [...node.rows].map((row, rowIndex) =>
        [...row.cells].map((cell): TableCell => {
          const imported = importHtml(cell.innerHTML);
          conversions.headings += imported.conversions.headings;
          conversions.links += imported.conversions.links;
          conversions.superscripts += imported.conversions.superscripts;
          conversions.subscripts += imported.conversions.subscripts;
          conversions.nestedTables += imported.tables + imported.conversions.nestedTables;

          const content = imported.nodes.flatMap((block): TextBlockNode[] =>
            block.kind === 'paragraph' || block.kind === 'heading'
              ? [block]
              : block.kind === 'table'
                ? [
                    {
                      kind: 'paragraph',
                      id: 0,
                      key: '',
                      text: tablePlainText(block),
                      marks: [],
                      inline: [],
                    },
                  ]
                : [],
          );

          // HTML rowspan=0 extends through the remaining rows in this row group.
          const rowspan =
            cell.rowSpan ||
            [...node.rows]
              .slice(rowIndex)
              .filter((candidate) => candidate.parentElement === row.parentElement).length;

          const paragraphs: TextBlockNode[] = content.length
            ? content.map((p) => {
                const id = nextId++;

                return { ...p, id, key: `html-${id}` };
              })
            : [
                {
                  kind: 'paragraph',
                  id: nextId,
                  key: `html-${nextId++}`,
                  text: '',
                  marks: [],
                  inline: [],
                },
              ];

          const id = nextId++;

          return {
            kind: 'tableCell',
            id,
            key: `html-${id}`,
            row: rowIndex,
            header: cell.tagName === 'TH',
            colspan: cell.colSpan,
            rowspan,
            paragraphs,
          };
        }),
      );

      if (rows.length) {
        const id = nextId++;
        nodes.push({
          kind: 'table',
          id,
          key: `html-${id}`,
          caption: node.caption?.textContent?.trim() ?? '',
          rows,
        });
        tables++;
      }

      return;
    }

    if (tag === 'BR') {
      text = text.replace(/ $/, '') + '\n';

      return;
    }

    const block = blocks.has(tag),
      heading = /^H[1-6]$/.test(tag);

    if (block) flush();
    const previousHeading = headingLevel;

    if (heading) {
      const level = Number(tag.slice(1));
      headingLevel = level === 1 ? 1 : level === 2 ? 2 : level === 3 ? 3 : 4;
      conversions.headings++;
    }

    if (tag === 'A') conversions.links++;

    if (tag === 'SUP') conversions.superscripts++;

    if (tag === 'SUB') conversions.subscripts++;
    const style = node instanceof HTMLElement ? node.style : undefined;

    const next = {
      bold:
        marks.bold ||
        tag === 'B' ||
        tag === 'STRONG' ||
        tag === 'TH' ||
        style?.fontWeight === 'bold' ||
        Number(style?.fontWeight) >= 600,
      italic: marks.italic || tag === 'I' || tag === 'EM' || style?.fontStyle === 'italic',
      underline: marks.underline || tag === 'U' || !!style?.textDecoration.includes('underline'),
    };

    for (const child of node.childNodes) visit(child, next);

    if (block) flush(tag === 'P' || heading);
    headingLevel = previousHeading;
  }

  for (const child of template.content.childNodes)
    visit(child, { bold: false, italic: false, underline: false });
  flush();

  return { nodes, tables, conversions };
}
