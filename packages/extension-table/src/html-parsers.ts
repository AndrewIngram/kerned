import { paragraph } from '@gprose/extension-document';
import { createDocumentSerializer } from '@gprose/model';
import type { HtmlParserContribution } from '@gprose/view';

import { table, tableCell } from './definitions.js';
import { tableSerializers } from './serialization.js';

const tables: HtmlParserContribution = {
  create(context) {
    const tableType = context.schema.node(table);
    const cellType = context.schema.node(tableCell);
    const paragraphType = context.schema.node(paragraph);

    const serializer = createDocumentSerializer(context.schema, tableSerializers, {
      unsupported: 'text',
    });

    function cellContent(element: Element) {
      function textBlocks(node: Parameters<typeof context.schema.text>[0]): (typeof node)[] {
        if (context.schema.text(node) !== null) return [node];

        if (tableType.matches(node))
          return [
            paragraphType.create(context.allocate(), {
              text: serializer.serialize([node]).text,
            }),
          ];

        return context.schema.children(node).flatMap(textBlocks);
      }

      const nodes = context.blocks(element).flatMap(textBlocks);

      return nodes.length ? nodes : [paragraphType.create(context.allocate(), { text: '' })];
    }

    return {
      kind: 'node',
      selector: 'table',
      parse(element) {
        if (!(element instanceof HTMLTableElement)) return null;
        const rows = [...element.rows].filter((row) => row.cells.length);

        const children = rows.flatMap((row, rowIndex) =>
          [...row.cells].map((cell) =>
            cellType.create(
              context.allocate(),
              {
                row: rowIndex,
                header: cell.tagName === 'TH',
                colspan: cell.colSpan,
                rowspan:
                  cell.rowSpan ||
                  rows
                    .slice(rowIndex)
                    .filter((candidate) => candidate.parentElement === row.parentElement).length,
              },
              cellContent(cell),
            ),
          ),
        );

        return children.length
          ? [
              tableType.create(
                context.allocate(),
                { caption: element.caption ? context.text(element.caption).text : '' },
                children,
              ),
            ]
          : [];
      },
    };
  },
};

export const tableHtmlParsers = [tables] as const;
