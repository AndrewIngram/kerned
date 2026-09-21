import { z } from 'zod';

import type { NodeBinding, NodeIdentity, Schema, SchemaDefinition } from '../model';
import { fontSelectionSchema } from './font-catalog';
import type { NodePresentation } from './presentation';

const positive = z.number().finite().positive();

const nonnegative = z.number().finite().nonnegative();

const nodeStyle = z.strictObject({
  color: z.string().trim().min(1).optional(),
  size: positive.optional(),
  lineHeight: positive.optional(),
  before: nonnegative.optional(),
  after: nonnegative.optional(),
  baselineGrid: nonnegative.optional(),
  font: fontSelectionSchema.optional(),
  indent: nonnegative.optional(),
});

export type NodeStyle = Readonly<z.infer<typeof nodeStyle>>;

type Definition = Extract<SchemaDefinition, { category: 'node' }>;

type Attributes<D extends Definition> = NonNullable<
  ReturnType<NodeBinding<NodeIdentity, D>['read']>
>;

const ruleIdentity: unique symbol = Symbol('style rule');

export type StyleRule = Readonly<{ name: string; [ruleIdentity]: true }>;

type BoundRule<N> = { name: string; read(node: N): NodeStyle };

const rules = new WeakMap<object, <N extends NodeIdentity>(schema: Schema<N>) => BoundRule<N>>();

/** Match an installed definition family and infer its normalized attribute type. */
export function defineStyleRule<D extends Definition>(
  definition: D,
  style: NodeStyle | ((attributes: Attributes<D>) => NodeStyle),
): StyleRule {
  let read: (attributes: Attributes<D>) => NodeStyle;

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This public input accepts a style object or a typed callback; both paths validate the resulting style at this boundary.
  if (typeof style === 'function') read = (attributes) => nodeStyle.parse(style(attributes));
  else {
    const fixed = nodeStyle.parse(style);
    read = () => fixed;
  }

  const rule: StyleRule = Object.freeze({
    name: definition.name,
    [ruleIdentity]: true,
  } satisfies StyleRule);

  rules.set(rule, <N extends NodeIdentity>(schema: Schema<N>): BoundRule<N> => {
    const binding = schema.node(definition);

    return {
      name: definition.name,
      read(node) {
        const attributes = binding.read(node);

        if (!attributes) throw new Error(`Style rule does not match ${definition.name}`);

        return read(attributes);
      },
    };
  });

  return rule;
}

const themeSchema = z.strictObject({
  baselineGrid: nonnegative.optional(),
  rules: z
    .array(
      z.custom<StyleRule>(
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The schema validates opaque rule identity without cloning it; WeakMap membership establishes the complete rule contract.
        (value) => typeof value === 'object' && value !== null && rules.has(value),
      ),
    )
    .optional(),
});

export type ViewTheme = Readonly<{
  baselineGrid?: number;
  rules?: readonly StyleRule[];
}>;

/** Compile and validate configuration once per view update, not during painting. */
export function createThemeStyles<N extends NodeIdentity>(
  schema: Schema<N>,
  input: ViewTheme = {},
) {
  const theme = themeSchema.parse(input);
  const bound = new Map<string, BoundRule<N>[]>();

  for (const rule of theme.rules ?? []) {
    const factory = rules.get(rule);

    if (!factory) throw new Error('Unknown style rule');
    const value = factory(schema);
    bound.set(value.name, [...(bound.get(value.name) ?? []), value]);
  }

  if (!bound.size && theme.baselineGrid === undefined)
    return (_node: N, defaults: NodePresentation) => defaults;

  return (node: N, defaults: NodePresentation): NodePresentation => {
    const matching = bound.get(schema.resolve(node).name);

    if (!matching?.length && theme.baselineGrid === undefined) return defaults;
    let style: NodeStyle = {};

    for (const rule of matching ?? []) {
      const next = rule.read(node);
      style = {
        color: next.color ?? style.color,
        size: next.size ?? style.size,
        lineHeight: next.lineHeight ?? style.lineHeight,
        before: next.before ?? style.before,
        after: next.after ?? style.after,
        baselineGrid: next.baselineGrid ?? style.baselineGrid,
        indent: next.indent ?? style.indent,
        font: next.font
          ? {
              family: next.font.family ?? style.font?.family,
              weight: next.font.weight ?? style.font?.weight,
              style: next.font.style ?? style.font?.style,
            }
          : style.font,
      };
    }

    if (defaults.kind === 'flow') {
      if (Object.entries(style).some(([key, value]) => key !== 'indent' && value !== undefined))
        throw new Error('Flowing containers support indentation rules only');

      return style.indent === undefined
        ? defaults
        : {
            kind: 'flow',
            child: (_index, inherited) => ({
              ...inherited,
              inset: inherited.inset + (style.indent ?? 0),
            }),
          };
    }

    if (style.indent !== undefined)
      throw new Error('Indentation rules require a flowing container');
    const { color, font, size, lineHeight, before, after, baselineGrid } = style;

    const spacing = {
      before: before ?? defaults.before,
      after: after ?? defaults.after,
      baselineGrid: baselineGrid ?? theme.baselineGrid ?? defaults.baselineGrid,
    };

    if (defaults.kind === 'box') {
      if (
        color !== undefined ||
        font !== undefined ||
        size !== undefined ||
        lineHeight !== undefined
      )
        throw new Error('Font rules require a text presentation');

      return { ...defaults, ...spacing };
    }

    return {
      ...defaults,
      ...spacing,
      color: color ?? defaults.color,
      size: size ?? defaults.size,
      lineHeight: lineHeight ?? defaults.lineHeight,
      font: font
        ? {
            family: font.family ?? defaults.font?.family,
            weight: font.weight ?? defaults.font?.weight,
            style: font.style ?? defaults.font?.style,
          }
        : defaults.font,
    };
  };
}
