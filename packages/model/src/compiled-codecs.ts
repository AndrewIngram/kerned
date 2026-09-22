import { nodeAttributes } from './compiled-attributes.js';
import { childrenOf, inlineOf, marksOf, textOf, withChildren } from './compiled-storage.js';
import type { RuntimeDocumentNode, SchemaDefinition, TextContent } from './definitions.js';
import type { createInlineValues } from './inline-schema.js';
import { validateInlineObjects } from './inline.js';
import type { createMarkSchema } from './marks.js';
import { jsonRecord, jsonString, type NodeCodec } from './schema-codec.js';

type NodeDefinition = Extract<SchemaDefinition, { category: 'node' }>;

/** The definition owns attributes; this codec owns identity-free, versioned data. */
export function compileNodeCodec(
  definition: NodeDefinition,
  marks: ReturnType<typeof createMarkSchema>,
  inlineCodec: ReturnType<typeof createInlineValues>,
): NodeCodec<RuntimeDocumentNode> {
  const content = definition.spec.content;

  function checkText(node: RuntimeDocumentNode, policy: TextContent) {
    const text = textOf(node, policy);
    const ranges = marksOf(node, policy);
    const inline = inlineOf(node, policy);

    if (
      policy.allowedMarks &&
      ranges.some((range) => !policy.allowedMarks!.includes(range.mark.type))
    )
      throw new Error('Unsupported mark for this node');

    if (policy.allowedInline && inline.some((value) => !policy.allowedInline!.includes(value.type)))
      throw new Error('Unsupported inline object for this node');
    marks.validate(text, ranges);
    validateInlineObjects(text, inline);
  }

  return {
    encode(node) {
      const data = nodeAttributes(definition, node);

      if (content.kind === 'text') {
        checkText(node, content);

        if (content.marks) data[content.marks] = marks.encode(marksOf(node, content));

        if (content.inline) data[content.inline] = inlineCodec.encode(inlineOf(node, content));
      }

      const children = content.kind === 'container' ? childrenOf(node, content) : [];

      return definition.spec.persistence?.encode(data, { children }) ?? data;
    },
    decode(value, { identity, children }) {
      const data = jsonRecord(definition.spec.persistence?.decode(value, { children }) ?? value);
      const reserved = ['id', 'key', 'kind', 'locked'];

      if (content.kind === 'container') reserved.push(content.field);

      if (reserved.some((key) => Object.hasOwn(data, key)))
        throw new Error('Encoded attributes contain a reserved node field');
      const raw = { ...data, ...identity, kind: definition.name };
      const attrs = nodeAttributes(definition, raw);
      let node: RuntimeDocumentNode = { ...attrs, ...identity, kind: definition.name };

      if (content.kind === 'container') return withChildren(node, content, children);

      if (content.kind === 'text') {
        const text = jsonString(attrs[content.field]);

        if (content.marks)
          node = { ...node, [content.marks]: marks.decode(text, data[content.marks] ?? []) };

        if (content.inline)
          node = {
            ...node,
            [content.inline]: inlineCodec.decode(text, data[content.inline] ?? []),
          };
        checkText(node, content);
      }

      return node;
    },
  };
}
