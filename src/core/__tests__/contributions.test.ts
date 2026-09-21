import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { createSchema, defineNode, type NodeIdentity } from '../../model';
import {
  createEditor,
  defineContribution,
  defineExtension,
  type ContributionContext,
  type ExtensionContext,
} from '../index';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

test('adapter contributions preserve order, configuration and session isolation without rerunning setup', () => {
  const values = defineContribution<{ label: string }>();
  const other = defineContribution<{ label: string }>();
  let setups = 0;

  const feature = defineExtension({
    name: 'feature',
    options: { label: 'default' },
    setup(options, context: ContributionContext) {
      setups++;
      context.provide(values, { label: options.label });
      context.provide(values, { label: 'second' });

      return {};
    },
  });

  const first = createEditor({
    schema: createSchema({ extensions: [note, feature] }),
    content: [],
  });

  const second = createEditor({
    schema: createSchema({ extensions: [note, feature.configure({ label: 'configured' })] }),
    content: [],
  });

  expectTypeOf(values.read(first)).toEqualTypeOf<readonly { label: string }[]>();
  expect(values.read(first)).toEqual([{ label: 'default' }, { label: 'second' }]);
  expect(values.read(second)).toEqual([{ label: 'configured' }, { label: 'second' }]);
  expect(other.read(first)).toEqual([]);
  expect(values.read(first)).toBe(values.read(first));
  expect(Object.isFrozen(values.read(first))).toBe(true);
  expect(setups).toBe(2);
  first.destroy();
  expect(() => values.read(first)).toThrow(/live composed editor/);
  expect(values.read(second)[0].label).toBe('configured');
  second.destroy();
  expect(() => values.read({ isDestroyed: false })).toThrow(/live composed editor/);
});

test('assembly closes registration after setup and before failed-setup cleanup', () => {
  const values = defineContribution<string>();
  let late: (() => void) | undefined;

  const feature = defineExtension({
    name: 'feature',
    options: {},
    setup(_options, context: ContributionContext) {
      context.provide(values, 'initial');
      late = () => context.provide(values, 'late');

      return {};
    },
  });

  const editor = createEditor({
    schema: createSchema({ extensions: [note, feature] }),
    content: [],
  });

  expect(() => late?.()).toThrow(/during setup/);
  expect(values.read(editor)).toEqual(['initial']);
  editor.destroy();
  expect(() => late?.()).toThrow(/during setup/);

  let cleaned = false;

  const failing = defineExtension({
    name: 'failing',
    options: {},
    setup(_options, context: Pick<ExtensionContext<NodeIdentity>, 'provide' | 'onDestroy'>): {} {
      context.provide(values, 'partial');
      context.onDestroy(() => {
        cleaned = true;
        expect(() => context.provide(values, 'after failure')).toThrow(/during setup/);
      });
      throw new Error('Setup failed');
    },
  });

  expect(() =>
    createEditor({ schema: createSchema({ extensions: [note, failing] }), content: [] }),
  ).toThrow('Setup failed');
  expect(cleaned).toBe(true);
});

function rejectedContribution(context: ContributionContext) {
  const labels = defineContribution<{ label: string }>();
  // @ts-expect-error A contribution key fixes its value contract; inference cannot widen it.
  context.provide(labels, { label: 42 });
}

void rejectedContribution;
