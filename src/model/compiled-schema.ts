import { validateValue } from './attribute-validation';
import { nodeAttributes } from './compiled-attributes';
import { compileNodeCodec } from './compiled-codecs';
import {
  childrenOf,
  inlineOf,
  marksOf,
  textOf,
  withChildren,
  validateGroups,
} from './compiled-storage';
import { childPolicy } from './content-policy';
import type { RuntimeDocumentNode, SchemaDefinition, TextContent } from './definitions';
import { replaceInlineObjects, sliceInlineObjects, validateInlineObjects } from './inline';
import { createInlineValues, type InlineValue } from './inline-schema';
import { createMarkSchema, normalizeMarks, sliceMarks, type MarkRange } from './marks';
import { createRuntimeSchema, type NodeType, type TextBehavior } from './schema';
import { boundaries } from './text';

type NodeDefinition = Extract<SchemaDefinition, { category: 'node' }>;

/** Compile declarative storage into document operations; no schema names are privileged. */
export function compileSchema(definitions: readonly SchemaDefinition[]) {
  const nodes = new Map(
    definitions.flatMap((definition) =>
      definition.category === 'node' ? [[definition.name, definition] as const] : [],
    ),
  );

  const marks = createMarkSchema(
    definitions.flatMap((definition) =>
      definition.category === 'mark'
        ? [
            {
              name: definition.name,
              version: definition.version,
              inclusiveStart: definition.spec.inclusiveStart,
              inclusiveEnd: definition.spec.inclusiveEnd,
              parse(value) {
                const result = validateValue(definition.spec.attributes, value, []);

                if ('issues' in result)
                  throw new Error(result.issues.map((issue) => issue.message).join('; '));

                return result.value;
              },
            },
          ]
        : [],
    ),
  );

  const inlineValues = createInlineValues(
    definitions.flatMap((definition) =>
      definition.category === 'inline'
        ? [
            {
              name: definition.name,
              version: definition.version,
              plainText: definition.spec.plainText,
              parse(value) {
                const parsed = validateValue(definition.spec.attributes, value, []);

                if ('issues' in parsed)
                  throw new Error(parsed.issues.map((issue) => issue.message).join('; '));

                return parsed.value;
              },
            },
          ]
        : [],
    ),
  );

  function textContent(node: RuntimeDocumentNode): TextContent {
    const content = nodes.get(node.kind)?.spec.content;

    if (content?.kind !== 'text') throw new Error('Expected a text node');

    return content;
  }

  function editing(
    definition: NodeDefinition,
    content: TextContent,
  ): TextBehavior<RuntimeDocumentNode> {
    function write(
      node: RuntimeDocumentNode,
      text: string,
      ranges: readonly MarkRange[],
      inline: readonly InlineValue[],
    ): RuntimeDocumentNode {
      if (!content.marks && ranges.length) throw new Error('This node does not support marks');

      if (!content.inline && inline.length)
        throw new Error('This node does not support inline objects');

      if (
        content.allowedMarks &&
        ranges.some((range) => !content.allowedMarks!.includes(range.mark.type))
      )
        throw new Error('Unsupported mark for this node');

      if (
        content.allowedInline &&
        inline.some((value) => !content.allowedInline!.includes(value.type))
      )
        throw new Error('Unsupported inline object for this node');
      const next = { ...node, [content.field]: text };

      if (content.marks) next[content.marks] = ranges;

      if (content.inline) next[content.inline] = inline;
      const normalized = nodeAttributes(definition, next);

      if (normalized[content.field] !== text)
        throw new Error('Text normalization during editing would invalidate position mappings');

      return { ...next, ...normalized };
    }

    function slice(node: RuntimeDocumentNode, from: number, to: number): RuntimeDocumentNode {
      return write(
        node,
        textOf(node, content).slice(from, to),
        sliceMarks(marksOf(node, content), from, to),
        sliceInlineObjects(inlineOf(node, content), from, to),
      );
    }

    const behavior: TextBehavior<RuntimeDocumentNode> = {
      text: (node) => textOf(node, content),
      replace(node, from, to, value) {
        const text = textOf(node, content);
        const nextText = text.slice(0, from) + value + text.slice(to);
        const delta = value.length - (to - from);
        const stops = boundaries(nextText);

        const ranges = marksOf(node, content)
          .flatMap((range) => {
            if (to <= range.from)
              return [{ ...range, from: range.from + delta, to: range.to + delta }];

            if (from >= range.to) return [range];

            const start = Math.min(range.from, from),
              end = Math.max(from + value.length, range.to + delta);

            return start < end ? [{ ...range, from: start, to: end }] : [];
          })
          .map((range) => ({
            ...range,
            from: stops.findLast((stop) => stop <= range.from) ?? 0,
            to: stops.find((stop) => stop >= range.to) ?? nextText.length,
          }));

        const inline = replaceInlineObjects(inlineOf(node, content), from, to, value.length);
        validateInlineObjects(nextText, inline);

        return write(node, nextText, ranges, inline);
      },
      split(node, at, identity) {
        const text = textOf(node, content);
        const left = slice(node, 0, at);
        // Clipboard slicing can pass a whole node as the identity source.
        const rightIdentity = { id: identity.id, key: identity.key };
        const right = { ...slice(node, at, text.length), ...rightIdentity };

        if (at !== text.length || !content.emptySplit || content.emptySplit === node.kind)
          return [left, right];
        const target = nodes.get(content.emptySplit);

        if (target?.spec.content.kind !== 'text')
          throw new Error('Empty split requires a text node');
        const targetContent = target.spec.content;

        const value = nodeAttributes(target, {
          ...rightIdentity,
          kind: target.name,
          [targetContent.field]: '',
        });

        const next = Object.assign(value, rightIdentity, { kind: target.name });

        if (node.locked !== undefined) next.locked = node.locked;

        if (targetContent.marks) next[targetContent.marks] = [];

        if (targetContent.inline) next[targetContent.inline] = [];

        return [left, next];
      },
      join(left, right) {
        const rightContent = textContent(right);
        const text = textOf(left, content);
        const rightText = textOf(right, rightContent);

        return write(
          left,
          text + rightText,
          normalizeMarks([
            ...marksOf(left, content),
            ...marksOf(right, rightContent).map((range) => ({
              ...range,
              from: range.from + text.length,
              to: range.to + text.length,
            })),
          ]),
          [
            ...inlineOf(left, content),
            ...inlineOf(right, rightContent).map((value) => ({
              ...value,
              index: value.index + text.length,
            })),
          ],
        );
      },
    };

    const field = content.marks;

    if (field)
      behavior.marks = {
        validate: (values) =>
          values.map((mark) => {
            if (content.allowedMarks && !content.allowedMarks.includes(mark.type))
              throw new Error(`Unsupported mark: ${mark.type}`);

            return marks.create(mark.type, mark.attrs);
          }),
        boundary: marks.boundary,
        read: (node) => marksOf(node, content),
        write(node, values) {
          return write(
            node,
            textOf(node, content),
            marks.validate(textOf(node, content), values),
            inlineOf(node, content),
          );
        },
      };

    return behavior;
  }

  const extensions: NodeType<RuntimeDocumentNode>[] = [...nodes.values()].map((definition) => {
    const content = definition.spec.content;

    const common = {
      name: definition.name,
      version: definition.version,
      selectable: definition.spec.selectable,
      codec: compileNodeCodec(definition, marks, inlineValues),
      validateUpdate(before: RuntimeDocumentNode, after: RuntimeDocumentNode) {
        if (content.kind === 'text') {
          if (
            textOf(before, content) !== textOf(after, content) ||
            (content.inline && inlineOf(before, content) !== inlineOf(after, content))
          )
            throw new Error('Text and inline objects require explicit editing operations');
          const ranges = marksOf(after, content);

          if (
            content.allowedMarks &&
            ranges.some((range) => !content.allowedMarks!.includes(range.mark.type))
          )
            throw new Error('Unsupported mark for this node');
          marks.validate(textOf(after, content), ranges);
        }

        nodeAttributes(definition, after);
      },
    };

    if (content.kind === 'atom') return { ...common, kind: 'atom' };

    if (content.kind === 'text')
      return { ...common, kind: 'text', editing: editing(definition, content) };

    const policy = childPolicy(content, definitions);

    return {
      ...common,
      kind: 'container',
      content: {
        children: (node) => childrenOf(node, content),
        withChildren: (node, children) => withChildren(node, content, children),
        validateChildren(node, children, { parent }) {
          validateGroups(node, content);

          if (content.parents && (!parent || !content.parents.includes(parent.kind)))
            throw new Error(`Invalid parent for ${definition.name}`);

          if (children.length < (content.minChildren ?? 0))
            throw new Error(`Not enough children for ${definition.name}`);

          if (policy.allowed && children.some((child) => !policy.allowed!.includes(child.kind)))
            throw new Error(`Invalid children for ${definition.name}`);

          if (policy.first && children.length && !policy.first.includes(children[0].kind))
            throw new Error(`Invalid first child for ${definition.name}`);
        },
      },
    };
  });

  return { ...createRuntimeSchema(extensions), marks, inline: inlineValues };
}
