import { defineExtension, type ContributionContext } from '@gprose/core';
import type { NodeIdentity, Schema } from '@gprose/model';
import {
  defineNodeAccessibility,
  nodeAccessibility,
  presentations,
  type BlockPresentation,
} from '@gprose/view';

import { table, tableCell } from './definitions.js';
import { tableRows } from './table.js';

export const tablePresentation = defineExtension({
  name: 'tablePresentation',
  options: {},
  requires: [table.name, tableCell.name],
  setup(_options, context: ContributionContext) {
    context.provide(
      nodeAccessibility,
      defineNodeAccessibility(table, (attrs) => ({ kind: 'table', caption: attrs.caption })),
    );
    context.provide(
      nodeAccessibility,
      defineNodeAccessibility(tableCell, (attrs) => ({ kind: 'cell', ...attrs })),
    );
    context.provide(presentations, {
      create<N extends NodeIdentity>(schema: Schema<N>) {
        const binding = schema.node(table);

        return {
          name: table.name,
          read(node: N): BlockPresentation {
            if (!binding.matches(node)) throw new Error('Expected table presentation');

            return {
              kind: 'box',
              height: Math.max(60, tableRows(schema, node).length * 64),
              before: 0,
              after: 24,
              baselineGrid: 4,
            };
          },
        };
      },
    });

    return {};
  },
});
