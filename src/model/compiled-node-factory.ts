import { z } from 'zod';

import { parseAttributes } from './attribute-validation';
import { reservedNodeFields } from './compiled-attributes';
import { inlineOf, withChildren } from './compiled-storage';
import type { RuntimeDocumentNode } from './definitions';
import { freezeJson } from './immutable-json';
import type { NodeDefinition, NodeFactory } from './node-binding';
import { jsonRecord } from './schema-codec';

const nodeIdentity = z.object({
  id: z.number().int(),
  key: z.string().min(1),
  locked: z.boolean().optional(),
});

type NodeDraft = { -readonly [Key in keyof RuntimeDocumentNode]: RuntimeDocumentNode[Key] };

/** Construct one node using the installed configuration. Child placement and
 * document-wide identities are validated when the draft inserts the result. */
export function compileNodeFactory(definition: NodeDefinition): NodeFactory<RuntimeDocumentNode> {
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
    create(identity, attributes, children) {
      const ownedIdentity = nodeIdentity.parse(identity);
      const parsed = parseAttributes(definition.spec, attributes, []);

      if ('issues' in parsed)
        throw new Error(parsed.issues.map((issue) => issue.message).join('; '));
      const attrs = jsonRecord(parsed.value);

      if (Object.keys(attrs).some((key) => reserved.has(key)))
        throw new Error('Attribute validator returned a reserved node field');
      freezeJson(attrs);

      const node: NodeDraft = {
        ...attrs,
        kind: definition.name,
        ...ownedIdentity,
      };

      if (content.kind === 'container')
        return Object.freeze(withChildren(node, content, [...children]));

      if (children.length) throw new Error('Only containers accept children');

      if (content.kind === 'text') {
        if (content.marks) node[content.marks] = Object.freeze([]);

        if (content.inline) node[content.inline] = Object.freeze([]);
      }

      return Object.freeze(node);
    },
  });
}
