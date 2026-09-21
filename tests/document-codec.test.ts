import { expect, test } from 'vitest';
import { z } from 'zod';

import type { StarterNode } from '../src/extensions/demo-model';
import { demoDocumentCodec } from '../src/extensions/demo-schema';

test('document nesting counts document nodes independently of JSON nesting', () => {
  let node: StarterNode = {
    kind: 'paragraph',
    id: 0,
    key: 'node-0',
    text: 'Text',
    marks: [],
    inline: [],
  };

  for (let id = 1; id <= 256; id++)
    node = { kind: 'quote', id, key: `node-${id}`, children: [node] };
  const encoded = demoDocumentCodec.encode([node]);

  expect(demoDocumentCodec.decode(encoded)).toEqual([node]);

  const extra = {
    type: 'quote',
    version: 1,
    id: 257,
    key: 'node-257',
    data: {},
    children: z.object({ nodes: z.array(z.unknown()) }).parse(encoded).nodes,
  };

  expect(() => demoDocumentCodec.decode({ version: 1, nodes: [extra] })).toThrow(z.ZodError);
});
