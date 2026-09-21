import {
  defineHtmlTextParser,
  defineHtmlValueParser,
  defineHtmlNodeParser,
  type HtmlParserContribution,
  type HtmlParseContext,
} from '../editor-browser';
import { createDocumentSerializer, type NodeIdentity } from '../model';
import {
  paragraph,
  heading,
  quote,
  list,
  listItem,
  table,
  tableCell,
  image,
  bold,
  italic,
  underline,
  mentionDefinition,
} from './starter-definitions';
import { starterSerializers } from './static-serializers';

function paragraphChildren<N extends NodeIdentity>(context: HtmlParseContext<N>, element: Element) {
  const children = context.blocks(element);

  return children.length
    ? children
    : [context.schema.node(paragraph).create(context.allocate(), { text: '' })];
}

const containers: HtmlParserContribution = {
  create(context) {
    const quoteType = context.schema.node(quote);
    const listType = context.schema.node(list);
    const itemType = context.schema.node(listItem);

    return {
      kind: 'node',
      selector: 'blockquote, ul, ol, li',
      parse(element) {
        let children = paragraphChildren(context, element);

        if (element.tagName === 'BLOCKQUOTE')
          return [quoteType.create(context.allocate(), {}, children)];

        if (element.tagName === 'LI') {
          // A list item must start with a block, even when external HTML begins with a sublist.
          if (children[0] && listType.matches(children[0]))
            children = [
              context.schema.node(paragraph).create(context.allocate(), { text: '' }),
              ...children,
            ];

          return [itemType.create(context.allocate(), {}, children)];
        }

        children = children.map((child) =>
          itemType.matches(child) ? child : itemType.create(context.allocate(), {}, [child]),
        );
        const start = Number(element.getAttribute('start') ?? 1);

        return [
          listType.create(
            context.allocate(),
            {
              ordered: element.tagName === 'OL',
              start: Number.isSafeInteger(start) && start > 0 ? start : 1,
            },
            children,
          ),
        ];
      },
    };
  },
};

const tables: HtmlParserContribution = {
  create(context) {
    const tableType = context.schema.node(table);
    const cellType = context.schema.node(tableCell);
    const paragraphType = context.schema.node(paragraph);

    const serializer = createDocumentSerializer(context.schema, starterSerializers, {
      unsupported: 'text',
    });

    function cellContent(element: Element) {
      function textBlocks(node: Parameters<typeof context.schema.text>[0]): (typeof node)[] {
        if (context.schema.text(node) !== null) return [node];

        if (tableType.matches(node))
          return [
            paragraphType.create(context.allocate(), { text: serializer.serialize([node]).text }),
          ];

        return context.schema.children(node).flatMap(textBlocks);
      }

      const nodes = context.blocks(element).flatMap(textBlocks);

      return nodes.length ? nodes : [paragraphType.create(context.allocate(), { text: '' })];
    }

    return {
      kind: 'node',
      selector: 'table',
      parse(element) {
        if (!(element instanceof HTMLTableElement)) return null;
        const rows = [...element.rows].filter((row) => row.cells.length);

        const children = rows.flatMap((row, rowIndex) =>
          [...row.cells].map((cell) =>
            cellType.create(
              context.allocate(),
              {
                row: rowIndex,
                header: cell.tagName === 'TH',
                colspan: cell.colSpan,
                rowspan:
                  cell.rowSpan ||
                  rows
                    .slice(rowIndex)
                    .filter((candidate) => candidate.parentElement === row.parentElement).length,
              },
              cellContent(cell),
            ),
          ),
        );

        return children.length
          ? [
              tableType.create(
                context.allocate(),
                { caption: element.caption ? context.text(element.caption).text : '' },
                children,
              ),
            ]
          : [];
      },
    };
  },
};

/** Resource URLs are external data. Retain only navigable web/file-relative image sources. */
function imageSource(element: Element) {
  const src = element.getAttribute('src')?.trim();

  if (!src) return false;

  if (!URL.canParse(src, 'https://gprose.invalid/')) return false;
  const url = new URL(src, 'https://gprose.invalid/');

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;

  return { src, alt: element.getAttribute('alt') ?? '' };
}

function dimension(element: Element, name: string, fallback: number) {
  const value = element.getAttribute(`data-gprose-${name}`);
  const number = value === null ? NaN : Number(value);

  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export const starterHtmlParsers: readonly HtmlParserContribution[] = [
  defineHtmlTextParser(paragraph, {
    selector: 'p',
    fallback: true,
    attributes: (_element, text) => ({ text }),
  }),
  defineHtmlTextParser(heading, {
    selector: 'h1, h2, h3, h4, h5, h6',
    attributes: (element, text) => {
      const level = Number(element?.tagName.slice(1));

      return {
        text,
        level:
          level === 1
            ? (1 as const)
            : level === 2
              ? (2 as const)
              : level === 3
                ? (3 as const)
                : (4 as const),
      };
    },
  }),
  containers,
  tables,
  defineHtmlNodeParser(image, { selector: 'img', attributes: imageSource }),
  defineHtmlValueParser(bold, {
    selector: 'b, strong, [style]',
    attributes: (element) => {
      const weight = element instanceof HTMLElement ? element.style.fontWeight : '';

      return element.matches('b, strong') || weight === 'bold' || Number(weight) >= 600
        ? null
        : false;
    },
  }),
  defineHtmlValueParser(italic, {
    selector: 'i, em, [style]',
    attributes: (element) =>
      element.matches('i, em') ||
      (element instanceof HTMLElement && element.style.fontStyle === 'italic')
        ? null
        : false,
  }),
  defineHtmlValueParser(underline, {
    selector: 'u, [style]',
    attributes: (element) =>
      element.matches('u') ||
      (element instanceof HTMLElement && element.style.textDecoration.includes('underline'))
        ? null
        : false,
  }),
  defineHtmlValueParser(mentionDefinition, {
    selector: '[data-gprose-mention]',
    attributes: (element) => ({
      label: element.getAttribute('data-gprose-mention') ?? '',
      width: dimension(element, 'width', 80),
      ascent: dimension(element, 'ascent', 18),
      descent: dimension(element, 'descent', 5),
    }),
  }),
];
