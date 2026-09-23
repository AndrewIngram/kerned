import { type NodeIdentity } from '@kerned/model';
import {
  defineHtmlTextParser,
  defineHtmlValueParser,
  defineHtmlNodeParser,
  type HtmlParserContribution,
  type HtmlParseContext,
} from '@kerned/view';

import {
  paragraph,
  heading,
  quote,
  list,
  listItem,
  image,
  bold,
  italic,
  underline,
  mentionDefinition,
} from './definitions.js';

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

/** Resource URLs are external data. Retain only navigable web/file-relative image sources. */
function imageSource(element: Element) {
  const src = element.getAttribute('src')?.trim();

  if (!src) return false;

  if (!URL.canParse(src, 'https://kerned.invalid/')) return false;
  const url = new URL(src, 'https://kerned.invalid/');

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;

  return { src, alt: element.getAttribute('alt') ?? '' };
}

function dimension(element: Element, name: string, fallback: number) {
  const value = element.getAttribute(`data-kerned-${name}`);
  const number = value === null ? NaN : Number(value);

  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export const documentHtmlParsers: readonly HtmlParserContribution[] = [
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
    selector: '[data-kerned-mention]',
    attributes: (element) => ({
      label: element.getAttribute('data-kerned-mention') ?? '',
      width: dimension(element, 'width', 80),
      ascent: dimension(element, 'ascent', 18),
      descent: dimension(element, 'descent', 5),
    }),
  }),
];
