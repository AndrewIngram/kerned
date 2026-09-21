import { z } from 'zod';

import { defineNode, defineMark, defineInline, jsonRecord, jsonNumber } from '../model';

export const bold = defineMark({
  name: 'bold',
  version: 1,
  options: {},
  schema: () => ({ attributes: z.null() }),
});

export const italic = defineMark({
  name: 'italic',
  version: 1,
  options: {},
  schema: () => ({ attributes: z.null() }),
});

export const underline = defineMark({
  name: 'underline',
  version: 1,
  options: {},
  schema: () => ({ attributes: z.null() }),
});

export const mentionDefinition = defineInline(
  {
    name: 'mention',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({
        label: z.string(),
        width: z.number().nonnegative(),
        ascent: z.number().nonnegative(),
        descent: z.number().nonnegative(),
      }),
    }),
  },
  (attrs) => attrs.label,
);

export const paragraph = defineNode({
  name: 'paragraph',
  version: 2,
  options: {},
  schema: () => ({
    groups: ['block', 'textblock'],
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text', marks: 'marks', inline: 'inline' },
  }),
});

export const heading = defineNode({
  name: 'heading',
  version: 2,
  options: { maxLevel: 4 },
  schema: (options) => ({
    groups: ['block', 'textblock'],
    attributes: z.strictObject({
      text: z.string(),
      level: z
        .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
        .refine((level) => level <= options.maxLevel, 'Unsupported heading level'),
    }),
    content: {
      kind: 'text',
      field: 'text',
      marks: 'marks',
      inline: 'inline',
      emptySplit: 'paragraph',
    },
  }),
});

export const image = defineNode({
  name: 'image',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.strictObject({ src: z.string(), alt: z.string() }),
    content: { kind: 'atom' },
  }),
});

export const quote = defineNode({
  name: 'quote',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.strictObject({}),
    content: {
      kind: 'container',
      field: 'children',
      allowedGroups: ['block', 'list'],
      minChildren: 1,
    },
  }),
});

export const list = defineNode({
  name: 'list',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['list'],
    attributes: z.strictObject({ ordered: z.boolean(), start: z.number().int().positive() }),
    content: { kind: 'container', field: 'children', allowed: ['listItem'], minChildren: 1 },
  }),
});

export const listItem = defineNode({
  name: 'listItem',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({}),
    content: {
      kind: 'container',
      field: 'children',
      allowedGroups: ['block', 'list'],
      firstGroups: ['block'],
      parents: ['list'],
      minChildren: 1,
    },
  }),
});

export const tableCell = defineNode({
  name: 'tableCell',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({
      row: z.number().int().nonnegative(),
      header: z.boolean(),
      colspan: z.number().int().positive(),
      rowspan: z.number().int().positive(),
    }),
    content: {
      kind: 'container',
      field: 'paragraphs',
      allowedGroups: ['textblock'],
      parents: ['table'],
      minChildren: 1,
    },
  }),
});

export const table = defineNode({
  name: 'table',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.strictObject({ caption: z.string() }),
    content: {
      kind: 'container',
      field: 'rows',
      depth: 2,
      groupBy: 'row',
      allowed: ['tableCell'],
      minChildren: 1,
    },
    persistence: {
      encode(data, { children }) {
        const rowLengths: number[] = [];

        for (const child of children) {
          const row = jsonNumber(child.row);
          rowLengths[row] = (rowLengths[row] ?? 0) + 1;
        }

        return { ...jsonRecord(data), rowLengths };
      },
      decode(data, { children }) {
        const { rowLengths, ...attrs } = jsonRecord(data);
        const lengths = z.array(z.number().int().positive()).parse(rowLengths);
        let offset = 0;

        for (const [row, length] of lengths.entries()) {
          const cells = children.slice(offset, offset + length);

          if (cells.length !== length || cells.some((child) => child.row !== row))
            throw new Error('Cell row index does not match table structure');
          offset += length;
        }

        if (offset !== children.length) throw new Error('Table row sizes do not match children');

        return attrs;
      },
    },
  }),
});

export const formattingDefinitions = [bold, italic, underline] as const;

export const starterDefinitions = [
  paragraph,
  heading,
  image,
  table,
  tableCell,
  quote,
  list,
  listItem,
  ...formattingDefinitions,
  mentionDefinition,
] as const;
