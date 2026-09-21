import { defineExtension, serializers, type ContributionContext } from '../core';
import {
  defineNodeSerializer,
  defineMarkSerializer,
  defineInlineSerializer,
  type HtmlOutput,
} from '../model';
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

/** Semantic static output is independent of canvas presentation and React/DOM node views. */
export const starterSerializers = [
  defineNodeSerializer(paragraph, ({ content }) => ({
    ...content,
    html: [{ tag: 'p', children: content.html }],
  })),
  defineNodeSerializer(heading, ({ attributes, content }) => ({
    ...content,
    html: [{ tag: `h${attributes.level}`, children: content.html }],
  })),
  defineNodeSerializer(quote, ({ content }) => ({
    ...content,
    html: [{ tag: 'blockquote', children: content.html }],
  })),
  defineNodeSerializer(list, ({ attributes, content }) => ({
    ...content,
    html: [
      {
        tag: attributes.ordered ? 'ol' : 'ul',
        attributes: { start: attributes.start },
        children: content.html,
      },
    ],
  })),
  defineNodeSerializer(listItem, ({ content }) => ({
    ...content,
    html: [{ tag: 'li', children: content.html }],
  })),
  defineNodeSerializer(table, ({ attributes, children }) => {
    const rows: { html: HtmlOutput[]; text: string[] }[] = [];

    for (const child of children) {
      const attrs = child.read(tableCell);

      if (!attrs) throw new Error('Expected table cell');
      const row = (rows[attrs.row] ??= { html: [], text: [] });
      row.html.push(...child.content.html);
      row.text.push(child.content.text);
    }

    return {
      html: [
        {
          tag: 'table',
          children: [
            { tag: 'caption', children: [attributes.caption] },
            ...rows.map((row) => ({ tag: 'tr', children: row.html })),
          ],
        },
      ],
      text: rows.map((row) => row.text.join('\t')).join('\n'),
    };
  }),
  defineNodeSerializer(tableCell, ({ attributes, content }) => ({
    ...content,
    html: [
      {
        tag: attributes.header ? 'th' : 'td',
        attributes: { colspan: attributes.colspan, rowspan: attributes.rowspan },
        children: content.html,
      },
    ],
  })),
  defineNodeSerializer(image, ({ attributes }) => ({
    html: [{ tag: 'img', attributes: { src: attributes.src, alt: attributes.alt } }],
    text: attributes.alt,
  })),
  defineMarkSerializer(bold, ({ content }) => ({
    ...content,
    html: [{ tag: 'strong', children: content.html }],
  })),
  defineMarkSerializer(italic, ({ content }) => ({
    ...content,
    html: [{ tag: 'em', children: content.html }],
  })),
  defineMarkSerializer(underline, ({ content }) => ({
    ...content,
    html: [{ tag: 'u', children: content.html }],
  })),
  defineInlineSerializer(mentionDefinition, (attributes) => ({
    html: [
      {
        tag: 'span',
        attributes: {
          'data-gprose-mention': attributes.label,
          'data-gprose-width': attributes.width,
          'data-gprose-ascent': attributes.ascent,
          'data-gprose-descent': attributes.descent,
        },
        children: [attributes.label],
      },
    ],
    text: attributes.label,
  })),
] as const;

export const starterSerialization = defineExtension({
  name: 'starterSerialization',
  options: {},
  setup(_options, context: ContributionContext) {
    for (const serializer of starterSerializers) context.provide(serializers, serializer);

    return {};
  },
});
