import { z } from 'zod';

import { parseAttributes } from './attribute-validation.js';
import { reservedNodeFields } from './compiled-attributes.js';
import { inlineOf, withChildren } from './compiled-storage.js';
import type { RuntimeDocumentNode } from './definitions.js';
import { freezeJson } from './immutable-json.js';
import type { createInlineValues } from './inline-schema.js';
import type { createMarkSchema } from './marks.js';
import { isChildContent, type NodeDefinition, type NodeFactory } from './node-binding.js';
import { jsonRecord, jsonString, readJsonRecord } from './schema-codec.js';

const nodeIdentity = z.object({
  id: z.number().int(),
  key: z.string().min(1),
  locked: z.boolean().optional(),
});

type NodeDraft = { -readonly [Key in keyof RuntimeDocumentNode]: RuntimeDocumentNode[Key] };

/** Construct one node using the installed configuration. Child placement and
 * document-wide identities are validated when the draft inserts the result. */
export function compileNodeFactory(
  definition: NodeDefinition,
  marks: ReturnType<typeof createMarkSchema>,
  inlineValues: ReturnType<typeof createInlineValues>,
): NodeFactory<RuntimeDocumentNode> {
  const reserved = reservedNodeFields(definition);
  const content = definition.spec.content;
  const attributeCache = new WeakMap<RuntimeDocumentNode, object>();

  return Object.freeze({
    definition,
    attributes(node) {
      let value = attributeCache.get(node);

      if (!value) {
        value = Object.freeze(
          Object.fromEntries(Object.entries(node).filter(([key]) => !reserved.has(key))),
        );
        attributeCache.set(node, value);
      }

      return value;
    },
    copy(node, identity) {
      const ownedIdentity = nodeIdentity.parse(identity);
      const next: NodeDraft = { ...node, ...ownedIdentity };

      if (content.kind === 'text' && content.inline)
        next[content.inline] = Object.freeze(
          inlineOf(node, content).map((value, index) =>
            Object.freeze({
              ...value,
              id: `${ownedIdentity.key}:inline:${index}`,
            }),
          ),
        );

      return Object.freeze(next);
    },
    create(identity, attributes, supplied) {
      const ownedIdentity = nodeIdentity.parse(identity);
      const parsed = parseAttributes(definition.spec, attributes, []);

      if ('issues' in parsed)
        throw new Error(parsed.issues.map((issue) => issue.message).join('; '));
      const attrs = readJsonRecord(parsed.value);

      if (Object.keys(attrs).some((key) => reserved.has(key)))
        throw new Error('Attribute validator returned a reserved node field');
      freezeJson(attrs);

      const node: NodeDraft = {
        ...attrs,
        kind: definition.name,
        ...ownedIdentity,
      };

      if (content.kind === 'container') {
        if (!isChildContent(supplied)) throw new Error('Containers require child nodes');

        return Object.freeze(withChildren(node, content, [...supplied]));
      }

      if (isChildContent(supplied) && supplied.length)
        throw new Error('Only containers accept children');

      if (content.kind === 'text') {
        const rich = isChildContent(supplied) ? {} : supplied;
        const text = jsonString(attrs[content.field]);
        const ranges = rich.marks ?? [];
        const inline = rich.inline ?? [];

        if ((ranges.length || inline.length) && jsonRecord(attributes)[content.field] !== text)
          throw new Error('Text normalization would invalidate supplied content offsets');

        if (
          (!content.marks && ranges.length) ||
          (content.allowedMarks &&
            ranges.some((range) => !content.allowedMarks!.includes(range.mark.type)))
        )
          throw new Error('Unsupported mark for this node');

        if (
          (!content.inline && inline.length) ||
          (content.allowedInline &&
            inline.some((value) => !content.allowedInline!.includes(value.type)))
        )
          throw new Error('Unsupported inline object for this node');

        const ownedMarks = marks.validate(text, ranges);
        const ownedInline = inlineValues.validate(text, inline);
        freezeJson({ marks: ownedMarks, inline: ownedInline });

        if (content.marks) node[content.marks] = ownedMarks;

        if (content.inline) node[content.inline] = ownedInline;
      } else if (!isChildContent(supplied)) throw new Error('Only text nodes accept text content');

      return Object.freeze(node);
    },
  });
}
