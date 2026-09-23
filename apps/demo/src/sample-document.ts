import { createMention } from '@kerned/extension-document';

import type { StarterNode } from './demo-model.js';

export function createSampleDocument(): StarterNode[] {
  const first = 'Review the draft with \ufffc before sharing it with the team.';

  const second =
    'We should keep the first release focused and gather feedback before expanding the scope.';

  const nodes: StarterNode[] = [
    {
      kind: 'paragraph',
      id: 1,
      key: 'block-1',
      text: first,
      marks: [],
      inline: [
        createMention({
          id: 'maya',
          index: first.indexOf('\ufffc'),
          label: '@Maya Chen',
          width: 132,
          ascent: 23,
          descent: 7,
        }),
      ],
    },
    { kind: 'paragraph', id: 2, key: 'block-2', text: second, marks: [], inline: [] },
    {
      kind: 'table',
      id: 3,
      key: 'block-3',
      caption: 'Review notes',
      rows: [
        [
          {
            kind: 'tableCell',
            id: 20001,
            key: 'review-cell',
            row: 0,
            header: false,
            colspan: 1,
            rowspan: 1,
            paragraphs: [
              {
                kind: 'paragraph',
                id: 20002,
                key: 'review-notes',
                text: 'Keep the first release focused.',
                marks: [],
                inline: [],
              },
            ],
          },
        ],
      ],
    },
    {
      kind: 'paragraph',
      id: 4,
      key: 'block-4',
      text: 'Tables stay part of the document. The next paragraph moves when a cell expands.',
      marks: [],
      inline: [],
    },
  ];

  for (let i = 0; i < 160; i++)
    nodes.push({
      kind: 'paragraph',
      id: i + 10,
      key: `block-${i + 10}`,
      text: `Section ${i + 1}. Canvas text keeps its own wrapping and caret geometry. Scroll to see only nearby interactive blocks mount.`,
      marks: [],
      inline: [],
    });

  return nodes;
}
