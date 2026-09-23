import * as modelModule from '@kerned/model';
import * as stateModule from '@kerned/state';
import { test, expect } from 'vitest';
import { z } from 'zod';

import * as editorBrowserModule from '../selection-view.js';

test('selection projection and multiclick ranges work with a foreign schema', async () => {
  const result = await (async () => {
    const {
      createSchema,
      defineNode,
      indexTree,
      selectionContext,
      selectionView,
      TextSelection,
      textSelectionAtClick,
    } = Object.assign({}, modelModule, stateModule, editorBrowserModule);

    const schema = createSchema({
      extensions: [
        defineNode({
          name: 'foreign',
          version: 1,
          options: {},
          schema: () => ({
            attributes: z.strictObject({ body: z.string() }),
            content: { kind: 'text', field: 'body' },
          }),
        }),
      ],
    });

    const nodes = [
      { id: 71, key: 'one', kind: 'foreign', body: 'First words' },
      { id: 99, key: 'two', kind: 'foreign', body: 'Second sentence' },
    ];

    const tree = indexTree(schema, nodes),
      context = selectionContext(schema, nodes, tree),
      indexes = new Map(nodes.map((node, index) => [node.id, index]));

    const forward = selectionView(
      schema,
      new TextSelection({ id: 71, offset: 6 }, { id: 99, offset: 6 }),
      context,
      indexes,
    );

    const backward = selectionView(
      schema,
      new TextSelection({ id: 99, offset: 6 }, { id: 71, offset: 6 }),
      context,
      indexes,
    );

    const word = textSelectionAtClick(nodes[1].body, 99, 9, false, 2),
      block = textSelectionAtClick(nodes[1].body, 99, 9, false, 3);

    return {
      forward: nodes.map(forward.selectedRange),
      backward: nodes.map(backward.selectedRange),
      word: [word.anchor, word.head],
      block: [block.anchor, block.head],
      single: textSelectionAtClick(nodes[0].body, 71, 4, false, 1),
    };
  })();

  expect(result.forward).toEqual([
    { from: 6, to: 11 },
    { from: 0, to: 6 },
  ]);
  expect(result.backward).toEqual(result.forward);
  expect(result.word).toEqual([
    { id: 99, offset: 7 },
    { id: 99, offset: 15 },
  ]);
  expect(result.block).toEqual([
    { id: 99, offset: 0 },
    { id: 99, offset: 15 },
  ]);
  expect(result.single).toBeNull();
});
