import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { createEditor, defineExtension, type ContributionContext } from '../../core';
import { createSchema, defineNode } from '../../model';
import { textSelection } from '../../state';
import { createDocumentPresentation, defineNodePresentation, presentations } from '../presentation';

const note = defineNode({
  name: 'note',
  version: 1,
  options: { fallback: 'Default' },
  schema: (options) => ({
    attributes: z.strictObject({ body: z.string().default(options.fallback) }),
    content: { kind: 'text', field: 'body' },
  }),
});

const section = defineNode({
  name: 'section',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ inset: z.number() }),
    content: { kind: 'container', field: 'items', allowed: ['note'] },
  }),
});

function extension() {
  let renders = 0;

  const view = defineExtension({
    name: 'view',
    options: { size: 18 },
    requires: [note.name, section.name],
    setup(options, context: ContributionContext) {
      context.provide(
        presentations,
        defineNodePresentation(note, () => (attrs) => {
          expectTypeOf(attrs.body).toEqualTypeOf<string>();
          renders++;

          return {
            kind: 'text',
            text: attrs.body,
            size: options.size,
            lineHeight: 28,
            before: 0,
            after: 12,
            baselineGrid: 4,
            spans: [],
            atoms: [],
          };
        }),
      );
      context.provide(
        presentations,
        defineNodePresentation(section, () => (attrs) => ({
          kind: 'flow',
          child: (_index, inherited) => ({ inset: inherited.inset + attrs.inset }),
        })),
      );

      return {};
    },
  });

  return { view, renders: () => renders };
}

test('compiled presentation uses installed definition families, typed normalized attributes and per-view caches', ({
  onTestFinished,
}) => {
  const f = extension();

  const editor = createEditor({
    schema: createSchema({
      extensions: [
        note.configure({ fallback: 'Configured' }),
        section,
        f.view.configure({ size: 22 }),
      ],
    }),
    content: [{ kind: 'section', inset: 24, items: [{ kind: 'note', id: 1 }] }],
  });

  onTestFinished(() => editor.destroy());
  const view = createDocumentPresentation(editor);
  const doc = view.query(editor.state);
  expect(doc.nodes).toHaveLength(1);
  expect(doc.projection.decorations.get(1)?.inset).toBe(24);
  expect(view.present(doc.nodes[0])).toMatchObject({ kind: 'text', text: 'Configured', size: 22 });
  editor.select(textSelection(1, 2));
  expect(view.query(editor.state).nodes).toBe(doc.nodes);
  expect(f.renders()).toBe(1);
  const otherView = createDocumentPresentation(editor);
  expect(otherView.query(editor.state).nodes[0]).toBe(doc.nodes[0]);
  expect(f.renders()).toBe(2);
});

test('duplicate and missing node presentations fail explicitly', ({ onTestFinished }) => {
  const { view } = extension();

  const second = defineExtension({
    name: 'second',
    options: {},
    setup(_options, context: ContributionContext) {
      context.provide(
        presentations,
        defineNodePresentation(note, () => () => ({
          kind: 'box',
          height: 30,
          before: 0,
          after: 0,
          baselineGrid: 0,
        })),
      );

      return {};
    },
  });

  const duplicate = createEditor({
    schema: createSchema({ extensions: [note, section, view, second] }),
    content: [{ kind: 'note' }],
  });

  const missing = createEditor({
    schema: createSchema({ extensions: [note] }),
    content: [{ kind: 'note' }],
  });

  onTestFinished(() => {
    duplicate.destroy();
    missing.destroy();
  });
  expect(() => createDocumentPresentation(duplicate)).toThrow(/Duplicate node presentation: note/);
  expect(() => createDocumentPresentation(missing).query(missing.state)).toThrow(
    /Missing node presentation: note/,
  );
});
