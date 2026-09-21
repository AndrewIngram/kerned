import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { createSchema, defineNode, defineMark, defineInline } from '../../model';
import { createEditor, defineExtension, defineCommand } from '../index';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

const ping = defineCommand({ execute: () => true });

// Deliberately weak author contracts exercise composition's compile-time rejection.
type OptionalNamespace = { commands?: { ping: typeof ping } };

type IndexedCommands = { commands: Record<string, typeof ping> };

type OptionalCommand = { commands: { ping?: typeof ping } };

type OptionalQuery = { queries: { answer?: () => number } };

test('capability names stay installed when an extension is disabled', () => {
  const extension = defineExtension({
    name: 'optionalFeature',
    options: { enabled: false },
    setup: (options) => ({
      commands: { ping: defineCommand({ execute: () => options.enabled }) },
      queries: { enabled: () => options.enabled },
    }),
  });

  const editor = createEditor({
    schema: createSchema({ extensions: [note, extension] }),
    content: [],
  });

  expectTypeOf(editor.commands.ping).parameters.toEqualTypeOf<[]>();
  expect(editor.commands.ping()).toBe(false);
  expect(editor.can().ping()).toBe(false);
  expect(editor.chain().ping().run()).toBe(false);
  expect(editor.getCommandState('ping').available).toBe(false);
  expect(editor.queries.enabled()).toBe(false);
  editor.destroy();
});

// Compile-only consumer examples: never invoke contracts deliberately rejected by composition.
function unstableContributions(enabled: boolean) {
  const privateName = Symbol('private');

  const symbolicCommand = defineExtension({
    name: 'symbolicCommand',
    options: {},
    setup: () => ({ commands: { [privateName]: ping } }),
  });

  // @ts-expect-error Runtime command registration uses string names, not symbol properties.
  createEditor({ schema: createSchema({ extensions: [note, symbolicCommand] }), content: [] });

  const symbolicQuery = defineExtension({
    name: 'symbolicQuery',
    options: {},
    setup: () => ({ queries: { [privateName]: () => 42 } }),
  });

  // @ts-expect-error Runtime query registration uses string names, not symbol properties.
  createEditor({ schema: createSchema({ extensions: [note, symbolicQuery] }), content: [] });

  const numericCommand = defineExtension({
    name: 'numericCommand',
    options: {},
    setup: () => ({ commands: { 1: ping } }),
  });

  // @ts-expect-error Command-state lookups use string names consistently with direct calls.
  createEditor({ schema: createSchema({ extensions: [note, numericCommand] }), content: [] });

  const namespace = defineExtension({
    name: 'namespace',
    options: { enabled },
    setup: (options) =>
      options.enabled ? { commands: { ping }, queries: { answer: () => 42 } } : {},
  });

  // @ts-expect-error A conditional namespace cannot promise installed methods.
  createEditor({ schema: createSchema({ extensions: [note, namespace] }), content: [] });

  const queryNamespace = defineExtension({
    name: 'queryNamespace',
    options: { enabled },
    setup: (options) => (options.enabled ? { queries: { answer: () => 42 } } : {}),
  });

  // @ts-expect-error Conditional query namespaces cannot promise installed queries.
  createEditor({ schema: createSchema({ extensions: [note, queryNamespace] }), content: [] });

  const optionalNamespace = defineExtension({
    name: 'optionalNamespace',
    options: {},
    setup: (): OptionalNamespace => ({}),
  });

  // @ts-expect-error Explicitly optional namespaces cannot promise installed methods.
  createEditor({ schema: createSchema({ extensions: [note, optionalNamespace] }), content: [] });

  const indexed = defineExtension({
    name: 'indexed',
    options: {},
    setup: (): IndexedCommands => ({ commands: {} }),
  });

  // @ts-expect-error A string index cannot guarantee that arbitrary command names exist.
  createEditor({ schema: createSchema({ extensions: [note, indexed] }), content: [] });

  const names = defineExtension({
    name: 'names',
    options: { enabled },
    setup: (options) => ({
      commands: options.enabled ? { ping } : { other: ping },
      queries: options.enabled ? { answer: () => 42 } : { other: () => 1 },
    }),
  });

  // @ts-expect-error Every installed name must exist regardless of the selected branch.
  createEditor({ schema: createSchema({ extensions: [note, names] }), content: [] });

  const optionalCommand = defineExtension({
    name: 'optionalCommand',
    options: {},
    setup: (): OptionalCommand => ({ commands: {} }),
  });

  // @ts-expect-error Optional command members are not guaranteed capabilities.
  createEditor({ schema: createSchema({ extensions: [note, optionalCommand] }), content: [] });

  const optionalQuery = defineExtension({
    name: 'optionalQuery',
    options: {},
    setup: (): OptionalQuery => ({ queries: {} }),
  });

  // @ts-expect-error Optional query members are not guaranteed capabilities.
  createEditor({ schema: createSchema({ extensions: [note, optionalQuery] }), content: [] });

  const optionalFactory = {
    category: 'node',
    name: 'raw',
    version: 1,
    requires: [],
    spec: note.spec,
    setup: () => (enabled ? { commands: { ping } } : undefined),
  } as const;

  // @ts-expect-error A raw factory returning undefined cannot guarantee its commands.
  createEditor({ schema: createSchema({ extensions: [optionalFactory] }), content: [] });

  const present = defineExtension({
    name: 'present',
    options: {},
    setup: () => ({ commands: { ping } }),
  });

  const absent = defineExtension({ name: 'absent', options: {}, setup: () => ({}) });
  // @ts-expect-error A union of definitions in one assembly slot cannot invent missing commands.
  createEditor({
    schema: createSchema({ extensions: [note, enabled ? present : absent] }),
    content: [],
  });

  const dynamic = enabled ? [present] : [];

  const dynamicEditor = createEditor({
    schema: createSchema({ extensions: [note, ...dynamic] }),
    content: [],
  });

  // @ts-expect-error A variable-length assembly does not prove a named command was installed.
  dynamicEditor.commands.ping();

  const signatures = defineExtension({
    name: 'signatures',
    options: { enabled },
    setup: (options) => ({
      commands: {
        ping: options.enabled
          ? defineCommand({ execute: (_context, value: string) => value.length > 0 })
          : defineCommand({ execute: (_context, value: number) => value > 0 }),
      },
    }),
  });

  // @ts-expect-error A runtime branch must not change a command's calling convention.
  createEditor({ schema: createSchema({ extensions: [note, signatures] }), content: [] });
}

void unstableContributions;

test('editor schema preserves typed mark and inline factories from the assembly', () => {
  const bold = defineMark({
    name: 'bold',
    version: 1,
    options: {},
    schema: () => ({ attributes: z.null() }),
  });

  const mention = defineInline(
    {
      name: 'mention',
      version: 1,
      options: {},
      schema: () => ({ attributes: z.strictObject({ user: z.string() }) }),
    },
    (attrs) => `@${attrs.user}`,
  );

  const schema = createSchema({ extensions: [note, bold, mention] });
  const editor = createEditor({ schema, content: [] });
  expect(editor.schema).toBe(schema);
  const mark = editor.schema.marks.create('bold', null);
  const inline = editor.schema.inline.create('mention', 'mention-1', 0, { user: 'alice' });
  expectTypeOf(mark.type).toEqualTypeOf<'bold'>();
  expectTypeOf(mark.attrs).toEqualTypeOf<null>();
  expectTypeOf(inline.type).toEqualTypeOf<'mention'>();
  expectTypeOf(inline.attrs.user).toEqualTypeOf<string>();
  expect(mark).toEqual({ type: 'bold', attrs: null });
  expect(inline).toEqual({ type: 'mention', id: 'mention-1', index: 0, attrs: { user: 'alice' } });

  function invalidFactories() {
    // @ts-expect-error Only installed marks are available.
    editor.schema.marks.create('missing', null);
    // @ts-expect-error Attributes belong to the installed mark.
    editor.schema.marks.create('bold', {});
    // @ts-expect-error Only installed inline definitions are available.
    editor.schema.inline.create('missing', 'id', 0, {});
    // @ts-expect-error Inline attributes retain their declared types.
    editor.schema.inline.create('mention', 'id', 0, { user: 123 });
    // @ts-expect-error Required inline attributes cannot be omitted.
    editor.schema.inline.create('mention', 'id', 0, {});
  }

  void invalidFactories;
  editor.destroy();
});
