import { expect, test } from 'vitest';
import { z } from 'zod';

import { createSchema, defineNode, type DocumentNode } from '../../model';
import type { NodeIdentity } from '../../model';
import { createStateField } from '../../state';
import { connectEditorView, createEditor, defineExtension, type ExtensionContext } from '../index';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

function resource(name: string, released: string[]) {
  return defineExtension({
    name,
    options: {},
    setup(_options, { onDestroy }: Pick<ExtensionContext<NodeIdentity>, 'onDestroy'>) {
      onDestroy(() => released.push(name));

      return {};
    },
  });
}

test('extension resources dispose in reverse order after the view and before lifecycle observers', () => {
  const observed: string[] = [];

  const schema = createSchema({
    extensions: [note, resource('first', observed), resource('second', observed)],
  });

  const editor = createEditor({ schema, content: [{ kind: 'note', text: 'A' }] });
  const other = createEditor({ schema, content: [] });
  connectEditorView(editor, { focus() {}, reveal() {}, destroy: () => observed.push('view') });
  editor.on('destroy', () => observed.push('observer'));
  editor.destroy();
  editor.destroy();
  expect(observed).toEqual(['view', 'second', 'first', 'observer']);
  expect(other.isDestroyed).toBe(false);
  other.destroy();
  expect(observed).toEqual(['view', 'second', 'first', 'observer', 'second', 'first']);
});

test('a failing factory cleans up both its own resources and completed factories', () => {
  const released: string[] = [];
  const failure = new Error('Setup failed');

  const failing = defineExtension({
    name: 'failing',
    options: {},
    setup(_options, { onDestroy }: Pick<ExtensionContext<NodeIdentity>, 'onDestroy'>) {
      onDestroy(() => released.push('failing'));
      throw failure;
    },
  });

  const schema = createSchema({
    extensions: [note, resource('first', released), failing, resource('never-started', released)],
  });

  expect(() => createEditor({ schema, content: [] })).toThrow(failure);
  expect(released).toEqual(['failing', 'first']);
});

test('registry collisions and state initialization failures dispose prepared extension resources', () => {
  for (const mode of ['command', 'query', 'field'] as const) {
    const released: string[] = [];

    const invalid = defineExtension({
      name: 'invalid',
      options: {},
      setup(_options, { onDestroy }: Pick<ExtensionContext<NodeIdentity>, 'onDestroy'>) {
        onDestroy(() => released.push('invalid'));

        if (mode === 'command') return { commands: { focus: { execute: () => true } } };

        if (mode === 'query') return { queries: { shared: () => 2 } };

        return {
          fields: [
            createStateField<DocumentNode<readonly [typeof note]>, number>({
              create: () => {
                throw new Error('Field failed');
              },
              update: (value) => value,
            }),
          ],
        };
      },
    });

    const query = defineExtension({
      name: 'query',
      options: {},
      setup: () => ({ queries: { shared: () => 1 } }),
    });

    const schema = createSchema({
      extensions: [note, resource('first', released), query, invalid],
    });

    expect(() => createEditor({ schema, content: [] })).toThrow(/Duplicate|Field failed/);
    expect(released).toEqual(['invalid', 'first']);
  }
});

test('cleanup failures retain the initialization error and do not skip other resources', () => {
  const released: string[] = [];
  const failure = new Error('Initialization failed');
  const cleanupFailure = new Error('Cleanup failed');

  const invalid = defineExtension({
    name: 'invalid',
    options: {},
    setup(_options, { onDestroy }: Pick<ExtensionContext<NodeIdentity>, 'onDestroy'>) {
      onDestroy(() => {
        released.push('invalid');
        throw cleanupFailure;
      });
      throw failure;
    },
  });

  const schema = createSchema({ extensions: [note, resource('first', released), invalid] });
  let caught: unknown;

  try {
    createEditor({ schema, content: [] });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(AggregateError);

  if (!(caught instanceof AggregateError)) throw new Error('Expected initialization aggregate');
  expect(caught.errors[0]).toBe(failure);
  expect(caught.errors[1]).toMatchObject({ errors: [cleanupFailure] });
  expect(released).toEqual(['invalid', 'first']);
});

test('late resource registrations are released immediately after session disposal', () => {
  const registrations: ExtensionContext<NodeIdentity>['onDestroy'][] = [];

  const extension = defineExtension({
    name: 'late',
    options: {},
    setup(_options, context: Pick<ExtensionContext<NodeIdentity>, 'onDestroy'>) {
      registrations.push(context.onDestroy);

      return {};
    },
  });

  const editor = createEditor({
    schema: createSchema({ extensions: [note, extension] }),
    content: [],
  });

  editor.destroy();
  const observed: string[] = [];
  registrations[0](() => observed.push('late'));
  expect(observed).toEqual(['late']);
  editor.destroy();
  expect(observed).toEqual(['late']);
});
