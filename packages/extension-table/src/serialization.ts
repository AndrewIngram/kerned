import { defineNodeSerializer, type HtmlOutput } from '@kerned/model';

import { table, tableCell } from './definitions.js';

export const tableSerializers = [
  defineNodeSerializer(table, ({ attributes, children }) => {
    const rows: { html: HtmlOutput[]; text: string[] }[] = [];

    for (const child of children) {
      const attrs = child.read(tableCell);

      if (!attrs) throw new Error('Expected table cell');
      const row = (rows[attrs.row] ??= { html: [], text: [] });
      row.html.push(...child.content.html);
      row.text.push(child.content.text);
    }

    return {
      html: [
        {
          tag: 'table',
          children: [
            { tag: 'caption', children: [attributes.caption] },
            ...rows.map((row) => ({ tag: 'tr', children: row.html })),
          ],
        },
      ],
      text: rows.map((row) => row.text.join('\t')).join('\n'),
    };
  }),
  defineNodeSerializer(tableCell, ({ attributes, content }) => ({
    ...content,
    html: [
      {
        tag: attributes.header ? 'th' : 'td',
        attributes: { colspan: attributes.colspan, rowspan: attributes.rowspan },
        children: content.html,
      },
    ],
  })),
] as const;
