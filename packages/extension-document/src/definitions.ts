import { defineNode, defineMark, defineInline } from '@gprose/model';
import { z } from 'zod';

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

export const formattingDefinitions = [bold, italic, underline] as const;

export type HeadingLevel = import('@standard-schema/spec').StandardSchemaV1.InferOutput<
  typeof heading.spec.attributes
>['level'];
