import * as modelModule from '@gprose/model';
import * as stateModule from '@gprose/state';
import { test, expect } from 'vitest';
import { z } from 'zod';

import * as demoSchemaModule from '../apps/demo/src/demo-schema.js';

test('custom attribute marks replace only their type and round-trip with versions', async () => {
  const result = await (async () => {
    const { createSchema, defineMark, setMark, removeMark, hasMark, sliceMarks } = modelModule;

    const { marks: schema } = createSchema({
      extensions: [
        defineMark({
          name: 'link',
          version: 2,
          options: {},
          schema: () => ({
            attributes: z.strictObject({ href: z.string().startsWith('https://') }),
          }),
        }),
        defineMark({
          name: 'emphasis',
          version: 1,
          options: {},
          schema: () => ({ attributes: z.null() }),
        }),
      ],
    });

    const a = schema.create('link', { href: 'https://a.test' }),
      b = schema.create('link', { href: 'https://b.test' }),
      em = schema.create('emphasis', null);

    let ranges = setMark([], 0, 10, a);
    ranges = setMark(ranges, 2, 8, em);
    ranges = setMark(ranges, 4, 6, b);
    const restored = schema.decode('0123456789', JSON.parse(JSON.stringify(schema.encode(ranges))));
    const rejected = [];

    for (const mutate of [
      (v) => (v[0].mark.version = 3),
      (v) => (v[0].mark.attrs = { href: 'javascript:bad' }),
      (v) => (v[0].to = 20),
    ]) {
      const value = schema.encode(ranges);
      mutate(value);

      try {
        schema.decode('0123456789', value);
        rejected.push(false);
      } catch {
        rejected.push(true);
      }
    }

    return {
      restored,
      equal: JSON.stringify(restored) === JSON.stringify(ranges),
      covered: hasMark(ranges, 2, 8, em),
      removed: removeMark(ranges, 3, 7, 'link'),
      sliced: sliceMarks(ranges, 3, 7),
      rejected,
    };
  })();

  expect(result.equal).toBe(true);
  expect(result.covered).toBe(true);
  expect(result.rejected).toEqual([true, true, true]);
  expect(result.restored.map((r) => [r.from, r.to, r.mark.type])).toEqual([
    [0, 4, 'link'],
    [2, 8, 'emphasis'],
    [4, 6, 'link'],
    [6, 10, 'link'],
  ]);
  expect(result.removed.filter((r) => r.mark.type === 'link').map((r) => [r.from, r.to])).toEqual([
    [0, 3],
    [7, 10],
  ]);
  expect(result.sliced.every((r) => r.from >= 0 && r.to <= 4)).toBe(true);
});

test('mark commands use a foreign node shape and preserve permissions and atomic undo', async () => {
  const result = await (async () => {
    const {
      createSchema,
      defineNode,
      defineMark,
      createEditor,
      textSelection,
      TextSelection,
      changeSelectionMarks,
      selectionHasMark,
    } = Object.assign({}, modelModule, stateModule);

    const schema = createSchema({
        extensions: [
          defineNode({
            name: 'line',
            version: 1,
            options: {},
            schema: () => ({
              attributes: z.strictObject({ value: z.string() }),
              content: { kind: 'text', field: 'value', marks: 'styles' },
            }),
          }),
          defineMark({
            name: 'review',
            version: 1,
            options: {},
            schema: () => ({ attributes: z.strictObject({ severity: z.number() }) }),
          }),
        ],
      }),
      initial = [1, 2].map((id) => ({
        id,
        key: `n${id}`,
        kind: 'line',
        value: 'Hello',
        styles: [],
      }));

    const editor = createEditor(
      schema,
      initial,
      new TextSelection({ id: 1, offset: 1 }, { id: 2, offset: 3 }),
    );

    const mark = { type: 'review', attrs: { severity: 2 } },
      steps = changeSelectionMarks(schema, editor.state, { kind: 'set', mark });

    editor.chain().steps(steps).run();

    const active = selectionHasMark(schema, editor.state, mark),
      ranges = editor.state.nodes.map((n) => n.styles);

    editor.undo();

    const denied = createEditor(schema, initial, textSelection(1, 0, 4), [], {
      permissions: { access: () => 'read-only' },
    });

    const allowed = denied
      .can()
      .steps(changeSelectionMarks(schema, denied.state, { kind: 'set', mark }))
      .run();

    return {
      active,
      ranges,
      undo: JSON.stringify(editor.state.nodes) === JSON.stringify(initial),
      allowed,
    };
  })();

  expect(result.active).toBe(true);
  expect(result.undo).toBe(true);
  expect(result.allowed).toBe(false);
  expect(result.ranges.map((r) => [r[0].from, r[0].to])).toEqual([
    [1, 5],
    [0, 3],
  ]);
});

test('document codecs reload durable comment endpoints with their independent checkpoint', async () => {
  const result = await (async () => {
    const { demoSchema, demoDocumentCodec } = demoSchemaModule;

    const { createEditor, textSelection, parseRelativeRange } = Object.assign(
      {},
      stateModule,
      modelModule,
    );

    const editor = createEditor(
      demoSchema,
      [
        {
          id: 1,
          key: 'p',
          kind: 'paragraph',
          text: 'Hello world',
          inline: [],
          marks: [{ from: 0, to: 5, mark: { type: 'bold', attrs: null } }],
        },
      ],
      textSelection(1, 0),
    );

    const range = editor.positions.range(
      editor.positions.at(1, 0, 1),
      editor.positions.at(1, 5, -1),
    );

    editor.chain().step({ kind: 'replaceText', id: 1, from: 2, to: 2, text: 'new' }).run();

    const data = JSON.parse(
      JSON.stringify({
        document: demoDocumentCodec.encode(editor.state.nodes),
        checkpoint: editor.positions.checkpoint(),
        range,
        documentId: editor.documentId,
        revision: editor.state.revision,
      }),
    );

    const restored = createEditor(
      demoSchema,
      demoDocumentCodec.decode(data.document),
      textSelection(1, 0),
      [],
      { documentId: data.documentId, revision: data.revision, positionCheckpoint: data.checkpoint },
    );

    const output = demoDocumentCodec.encode(restored.state.nodes);
    output.nodes[0].data.text = 'mutated output';

    return {
      resolved: restored.positions.resolveRange(parseRelativeRange(data.range)),
      text: restored.state.nodes[0].text,
      bold: restored.state.nodes[0].marks[0].mark.type === 'bold',
    };
  })();

  expect(result).toEqual({
    resolved: { status: 'resolved', ranges: [{ id: 1, from: 0, to: 8 }] },
    text: 'Henewllo world',
    bold: true,
  });
});

test('third-party node codecs own their payload while core enforces identities', async () => {
  const result = await (async () => {
    const { createSchema, defineNode, createDocumentCodec, jsonRecord, jsonString } = modelModule;

    let corrupt = false;

    const extension = defineNode({
      name: 'card',
      version: 3,
      options: {},
      schema: () => ({
        attributes: z.strictObject({ title: z.string() }),
        content: { kind: 'atom' },
        persistence: {
          encode: (data) => ({ title: jsonString(jsonRecord(data).title) }),
          decode: (data) =>
            corrupt
              ? { key: 'changed', title: jsonString(jsonRecord(data).title) }
              : { title: jsonString(jsonRecord(data).title) },
        },
      }),
    });

    const codec = createDocumentCodec(createSchema({ extensions: [extension] }));

    const original = [
        { kind: 'card', id: 7, key: 'stable', locked: true, title: 'Custom content' },
      ],
      encoded = jsonRecord(codec.encode(original));

    const round = codec.decode(JSON.parse(JSON.stringify(encoded)));
    const rejects = [];

    for (const value of [
      null,
      {},
      { ...encoded, nodes: [{ ...jsonRecord(encoded.nodes[0]), data: { title: 42 } }] },
    ]) {
      try {
        codec.decode(value);
        rejects.push(false);
      } catch {
        rejects.push(true);
      }
    }

    corrupt = true;

    try {
      codec.decode(encoded);
      rejects.push(false);
    } catch {
      rejects.push(true);
    }

    return { round, original, rejects };
  })();

  expect(result.round).toEqual(result.original);
  expect(result.rejects).toEqual([true, true, true, true]);
});
