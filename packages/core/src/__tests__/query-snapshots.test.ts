import { createSchema, defineNode } from '@gprose/model';
import { textSelection } from '@gprose/state';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { createEditor, defineExtension, defineQuery } from '../index.js';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

test('defined queries share snapshot results, invalidate on selection/edits, and isolate sessions', () => {
  let calls = 0;

  const query = defineQuery(({ state, schema }, suffix: string) => {
    calls++;

    return { label: schema.text(state.nodes[0]) + suffix };
  });

  const extension = defineExtension({
    name: 'labels',
    options: {},
    setup: () => ({ queries: { label: query } }),
  });

  const schema = createSchema({ extensions: [note, extension] });
  const first = createEditor({ schema, content: [{ kind: 'note', id: 1, text: 'First' }] });
  const second = createEditor({ schema, content: [{ kind: 'note', id: 1, text: 'Second' }] });
  const value = first.queries.label('!');
  first.queries.label('?');
  expect(first.queries.label('!')).toBe(value);
  expect(calls).toBe(2);
  expect(second.queries.label('!').label).toBe('Second!');
  expect(first.queries.label('!')).toBe(value);
  expect(calls).toBe(3);
  first.select(textSelection(1, 2));
  expect(first.queries.label('!')).not.toBe(value);
  expect(calls).toBe(4);
  first.dispatch({
    baseRevision: first.state.revision,
    origin: 'local',
    history: 'separate',
    time: 1,
    steps: [{ kind: 'replaceText', id: 1, from: 0, to: 5, text: 'Edited' }],
  });
  expect(first.queries.label('!').label).toBe('Edited!');
  first.destroy();
  second.destroy();
});

test('mutable arguments and ordinary contributed queries remain uncached', () => {
  let external = 'one';
  const query = defineQuery((_context, options: { suffix: string }) => options.suffix);

  const extension = defineExtension({
    name: 'mutable',
    options: {},
    setup: () => ({ queries: { read: query, external: () => external } }),
  });

  const editor = createEditor({
    schema: createSchema({ extensions: [note, extension] }),
    content: [{ kind: 'note', text: '' }],
  });

  const options = { suffix: 'first' };
  expect(editor.queries.read(options)).toBe('first');
  options.suffix = 'changed';
  expect(editor.queries.read(options)).toBe('changed');
  expect(editor.queries.external()).toBe('one');
  external = 'two';
  expect(editor.queries.external()).toBe('two');
  editor.destroy();
});
