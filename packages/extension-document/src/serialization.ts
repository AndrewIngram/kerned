import { defineNodeSerializer, defineMarkSerializer, defineInlineSerializer } from '@gprose/model';

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

export const documentSerializers = [
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
