import { createSchema, defineNode, type DocumentNode } from '@gprose/model';
import { z } from 'zod';

const extensions = [
  defineNode({
    name: 'note',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({ value: z.string() }),
      content: { kind: 'text', field: 'value' },
    }),
  }),
  defineNode({
    name: 'group',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({}),
      content: { kind: 'container', field: 'children' },
    }),
  }),
] as const;

export const schema = createSchema({ extensions });

export type Node = DocumentNode<typeof extensions>;

export function* replacementCases() {
  for (let a = 0; a <= 4; a++)
    for (let ae = a; ae <= 4; ae++)
      for (let b = 0; b <= 4; b++)
        for (let be = b; be <= 4; be++)
          yield {
            first: { key: 'one', from: a, to: ae, text: 'X', expected: 'abcd'.slice(a, ae) },
            second: { key: 'one', from: b, to: be, text: 'Y', expected: 'abcd'.slice(b, be) },
          };
}
