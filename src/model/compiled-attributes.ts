import { validateValue } from './attribute-validation';
import type { RuntimeDocumentNode, SchemaDefinition } from './definitions';
import { jsonRecord } from './schema-codec';

type NodeDefinition = Extract<SchemaDefinition, { category: 'node' }>;

export function nodeAttributes(definition: NodeDefinition, node: RuntimeDocumentNode) {
  const content = definition.spec.content;
  const reserved = new Set(['id', 'key', 'kind', 'locked']);

  if (content.kind === 'container') reserved.add(content.field);

  if (content.kind === 'text') {
    if (content.marks) reserved.add(content.marks);

    if (content.inline) reserved.add(content.inline);
  }

  const result = validateValue(
    definition.spec.attributes,
    Object.fromEntries(Object.entries(node).filter(([key]) => !reserved.has(key))),
    [],
  );

  if ('issues' in result) throw new Error(result.issues.map((issue) => issue.message).join('; '));

  const normalized = jsonRecord(result.value);

  if (Object.keys(normalized).some((key) => reserved.has(key)))
    throw new Error('Attribute validator returned a reserved node field');

  return normalized;
}
