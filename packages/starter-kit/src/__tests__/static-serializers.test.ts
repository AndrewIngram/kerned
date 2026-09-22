import { createEditor, createEditorSerializer } from '@gprose/core';
import { createSchema, createDocumentCodec } from '@gprose/model';
import { expect, test } from 'vitest';

import { starterExtensions } from '../index.js';

test('assembled headless starter output covers rich tables, heading levels, mentions and images', () => {
  const editor = createEditor({
    schema: createSchema({ extensions: starterExtensions }),
    content: [
      { kind: 'heading', level: 4, text: 'Heading' },
      {
        kind: 'table',
        caption: 'A & B',
        rows: [
          [
            {
              kind: 'tableCell',
              row: 0,
              header: true,
              colspan: 2,
              rowspan: 1,
              paragraphs: [
                {
                  kind: 'paragraph',
                  text: 'Hi \ufffc',
                  marks: [{ from: 0, to: 2, mark: { type: 'bold', attrs: null } }],
                  inline: [
                    {
                      type: 'mention',
                      id: 'm',
                      index: 3,
                      attrs: { label: 'Ada', width: 40, ascent: 20, descent: 4 },
                    },
                  ],
                },
              ],
            },
          ],
        ],
      },
      { kind: 'image', src: '/image.png', alt: 'A < B' },
    ],
  });

  try {
    const serializer = createEditorSerializer(editor);
    const output = serializer.serialize(editor.state.nodes);
    expect(output).toEqual({
      html: '<h4>Heading</h4><table><caption>A &amp; B</caption><tr><th colspan="2" rowspan="1"><p><strong>Hi</strong> <span data-gprose-mention="Ada" data-gprose-width="40" data-gprose-ascent="20" data-gprose-descent="4">Ada</span></p></th></tr></table><img src="/image.png" alt="A &lt; B">',
      text: 'Heading\n\nHi Ada\n\nA < B',
    });
    const codec = createDocumentCodec(editor.schema);
    const restored = codec.decode(JSON.parse(JSON.stringify(codec.encode(editor.state.nodes))));
    expect(serializer.serialize(restored)).toEqual(output);
  } finally {
    editor.destroy();
  }
});
