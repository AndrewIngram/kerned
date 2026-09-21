import { expect, test } from 'vitest';
import { z } from 'zod';

import { createSchema, defineNode, defineInline, textContent } from '../index';

const label = defineInline(
  {
    name: 'label',
    version: 1,
    options: {},
    schema: () => ({ attributes: z.strictObject({ title: z.string() }) }),
  },
  (attrs) => attrs.title,
);

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ body: z.string() }),
    content: { kind: 'text', field: 'body', inline: 'tokens' },
  }),
});

test('text content follows schema fields, inline labels and UTF-16 ranges without relying on inline array order', () => {
  const schema = createSchema({ extensions: [note, label] });

  const parsed = schema['~standard'].validate([
    {
      kind: 'note',
      body: 'A\ufffc😀\ufffcZ',
      tokens: [
        { id: 'second', index: 4, type: 'label', attrs: { title: 'Two' } },
        { id: 'first', index: 1, type: 'label', attrs: { title: 'One' } },
      ],
    },
  ]);

  if (parsed.issues) throw new Error('Expected valid custom text');
  const node = parsed.value[0];
  expect(textContent(schema, node)).toBe('AOne😀TwoZ');
  expect(textContent(schema, node, 2, 5)).toBe('😀Two');
  expect(schema.editing(node).inline?.read(node)).toBe(node.tokens);
  expect(Object.isFrozen(schema.editing(node).inline)).toBe(true);
});
