import { createSchema, defineNode, parseRelativeRange, type DocumentNode } from '@gprose/model';
import { createEditor, textSelection } from '@gprose/state';
import { applySteps, createPositionSnapshot, restoreChanges } from '@gprose/transform';
import { expect, test } from 'vitest';
import { z } from 'zod';

const line = defineNode({
  name: 'line',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ content: z.string() }),
    content: { kind: 'text', field: 'content' },
  }),
});

const schema = createSchema({ extensions: [line] });

type Line = DocumentNode<readonly [typeof line]>;

const original: Line[] = [{ id: 1, key: 'line-one', kind: 'line', content: 'Hello world' }];

test('public headless modules edit and invert a document without a session or browser', () => {
  expect('document' in globalThis).toBe(false);
  expect('window' in globalThis).toBe(false);

  const result = applySteps(schema, original, [
    { kind: 'split', id: 1, at: 5, rightId: 2, rightKey: 'line-two' },
    { kind: 'replaceText', id: 2, from: 0, to: 1, text: ', ' },
  ]);

  expect(result.nodes.map((node) => node.content)).toEqual(['Hello', ', world']);
  expect(original[0].content).toBe('Hello world');
  expect(result.maps.map((map) => map.kind)).toEqual(['children', 'split', 'replace']);
  expect(result.anchorMaps.map((map) => map.kind)).toEqual(['split', 'replace']);

  const restored = restoreChanges(result.nodes, result.changes, 'backward');
  expect(restored.nodes[0]).toBe(original[0]);
  expect(restoreChanges(restored.nodes, result.changes, 'forward').nodes).toEqual(result.nodes);
  expect(() => restoreChanges([{ ...result.nodes[0] }], result.changes, 'backward')).toThrow(
    /rebasing/,
  );
});

test('append produces invertible document changes without choosing a session history policy', () => {
  const result = applySteps(schema, original, [
    { kind: 'append', nodes: [{ id: 2, key: 'line-two', kind: 'line', content: 'Next line' }] },
  ]);

  expect(result.changedIds).toEqual([2]);
  expect(restoreChanges(result.nodes, result.changes, 'backward').nodes).toEqual(original);
});

test('step authorization observes preceding property updates and failure leaves input intact', () => {
  const observed: boolean[] = [];

  expect(() =>
    applySteps(
      schema,
      original,
      [
        { kind: 'updateBlock', node: { ...original[0], locked: true } },
        { kind: 'updateBlock', node: { ...original[0], locked: false } },
      ],
      {
        beforeStep(nodes) {
          observed.push(nodes[0].locked === true);

          if (nodes[0].locked) throw new Error('Locked node');
        },
      },
    ),
  ).toThrow('Locked node');
  expect(observed).toEqual([false, true]);
  expect(original[0].locked).toBeUndefined();
});

test('state publishes transforms and retains durable ranges independently of its journal', () => {
  const editor = createEditor(schema, original, textSelection(1, 0), [], {
    documentId: 'headless-consumer',
  });

  const range = parseRelativeRange({
    version: 1,
    start: editor.positions.at(1, 0, 1),
    end: editor.positions.at(1, 5, -1),
  });

  const snapshot = createPositionSnapshot(schema, editor.state);
  const point = snapshot.text(1, 5);

  editor.dispatch({
    baseRevision: 0,
    origin: 'local',
    history: 'separate',
    time: 1,
    steps: [{ kind: 'replaceText', id: 1, from: 2, to: 2, text: '!' }],
  });
  editor.compactJournal();
  expect(editor.journal).toHaveLength(0);
  expect(editor.positions.resolveRange(range)).toEqual({
    status: 'resolved',
    ranges: [{ id: 1, from: 0, to: 6 }],
  });
  expect(() => createPositionSnapshot(schema, editor.state).resolve(point)).toThrow(/snapshot/);
  editor.undo();
  expect(editor.state.nodes).toEqual(original);
  expect(editor.positions.resolveRange(range)).toEqual({
    status: 'resolved',
    ranges: [{ id: 1, from: 0, to: 5 }],
  });
});
