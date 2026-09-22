import { defineNode, jsonRecord, jsonNumber } from '@gprose/model';
import { z } from 'zod';

export const tableCell = defineNode({
  name: 'tableCell',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({
      row: z.number().int().nonnegative(),
      header: z.boolean(),
      colspan: z.number().int().positive(),
      rowspan: z.number().int().positive(),
    }),
    content: {
      kind: 'container',
      field: 'paragraphs',
      allowedGroups: ['textblock'],
      parents: ['table'],
      minChildren: 1,
    },
  }),
});

export const table = defineNode({
  name: 'table',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.strictObject({ caption: z.string() }),
    content: {
      kind: 'container',
      field: 'rows',
      depth: 2,
      groupBy: 'row',
      allowed: ['tableCell'],
      minChildren: 1,
    },
    persistence: {
      encode(data, { children }) {
        const rowLengths: number[] = [];

        for (const child of children) {
          const row = jsonNumber(child.row);
          rowLengths[row] = (rowLengths[row] ?? 0) + 1;
        }

        return { ...jsonRecord(data), rowLengths };
      },
      decode(data, { children }) {
        const { rowLengths, ...attrs } = jsonRecord(data);
        const lengths = z.array(z.number().int().positive()).parse(rowLengths);
        let offset = 0;

        for (const [row, length] of lengths.entries()) {
          const cells = children.slice(offset, offset + length);

          if (cells.length !== length || cells.some((child) => child.row !== row))
            throw new Error('Cell row index does not match table structure');
          offset += length;
        }

        if (offset !== children.length) throw new Error('Table row sizes do not match children');

        return attrs;
      },
    },
  }),
});
