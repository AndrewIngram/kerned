import { createEditor, defineExtension, type ContributionContext } from '@kerned/core';
import { createMention } from '@kerned/extension-document';
import { createSchema, defineNode } from '@kerned/model';
import { starterBrowserExtensions } from '@kerned/starter-kit/browser';
import { textSelection, type NodeAccess } from '@kerned/state';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { createReadingView, defineNodeAccessibility, nodeAccessibility } from '../accessibility.js';

const schema = createSchema({ extensions: starterBrowserExtensions() });

function paragraph(id: number, text: string) {
  return { kind: 'paragraph' as const, id, text };
}

test('reading projection preserves nested semantics, table spans and document order', ({
  onTestFinished,
}) => {
  const editor = createEditor({
    schema,
    content: [
      { kind: 'heading', id: 1, level: 2, text: 'Chapter' },
      { kind: 'quote', id: 2, children: [paragraph(3, 'Quoted words')] },
      {
        kind: 'list',
        id: 4,
        ordered: true,
        start: 3,
        children: [{ kind: 'listItem', id: 5, children: [paragraph(6, 'An item')] }],
      },
      {
        kind: 'table',
        id: 7,
        caption: 'Results',
        rows: [
          [
            {
              kind: 'tableCell',
              id: 8,
              row: 0,
              header: true,
              colspan: 2,
              rowspan: 1,
              paragraphs: [paragraph(9, 'Title')],
            },
          ],
          [
            {
              kind: 'tableCell',
              id: 10,
              row: 1,
              header: false,
              colspan: 1,
              rowspan: 1,
              paragraphs: [paragraph(11, 'Data')],
            },
          ],
        ],
      },
      { kind: 'image', id: 12, src: 'https://invalid.example/never-fetch.png', alt: 'Mountain' },
    ],
  });

  const errors: Error[] = [];
  const reader = createReadingView(document, editor, (error) => errors.push(error));
  document.body.append(reader.element);
  onTestFinished(() => {
    reader.destroy();
    editor.destroy();
  });
  expect(reader.element.hidden).toBe(true);
  expect(reader.element.children).toHaveLength(0);
  reader.enable(true);
  expect(reader.element.querySelector('h2')?.textContent).toBe('Chapter');
  expect(reader.element.querySelector('blockquote p')?.textContent).toBe('Quoted words');
  expect(reader.element.querySelector('ol')?.start).toBe(3);
  expect(reader.element.querySelector('ol > li > p')?.textContent).toBe('An item');
  const table = reader.element.querySelector('table');
  expect(table?.getAttribute('aria-label')).toBe('Results');
  expect(table?.rows).toHaveLength(2);
  expect(table?.rows[0].cells[0].colSpan).toBe(2);
  expect(table?.rows[0].cells[0].tagName).toBe('TH');
  expect(table?.rows[1].cells[0].textContent).toBe('Data');
  expect(reader.element.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Mountain');
  expect(reader.element.querySelector('[src], [contenteditable]')).toBeNull();
  expect(
    [...reader.element.children].map((element) => element.getAttribute('data-reading-node')),
  ).toEqual(['1', '2', '4', '7', '12']);
  const heading = reader.element.querySelector('h2');
  const cell = table?.rows[0].cells[0];
  editor.select(textSelection(11, 0, 4));
  expect(editor.commands.toggleFormat('bold')).toBe(true);
  expect(reader.element.querySelector('h2')).toBe(heading);
  expect(reader.element.querySelector('th')).toBe(cell);
  reader.enable(false);
  expect(reader.element.children).toHaveLength(0);
  reader.enable(true);
  expect(reader.element.querySelector('h2')?.textContent).toBe('Chapter');
  expect(errors).toEqual([]);
});

test('schema-bound descriptions stay behind inherited permissions and refresh without canvas layout', ({
  onTestFinished,
}) => {
  const custom = defineNode({
    name: 'custom',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({ body: z.string() }),
      content: { kind: 'text', field: 'body' },
      groups: ['block'],
    }),
  });

  let reads = 0;

  const semantics = defineExtension({
    name: 'semantics',
    options: {},
    setup(_options, context: ContributionContext) {
      context.provide(
        nodeAccessibility,
        defineNodeAccessibility(custom, () => {
          reads++;

          return { kind: 'heading', level: 3 };
        }),
      );

      return {};
    },
  });

  let access: NodeAccess = 'protected';

  const editor = createEditor({
    schema: createSchema({ extensions: [...starterBrowserExtensions(), custom, semantics] }),
    content: [
      { kind: 'quote', id: 1, children: [{ kind: 'custom', id: 2, body: 'Secret heading' }] },
      paragraph(3, 'Public'),
    ],
    permissions: { access: (node) => (node.id === 1 ? access : 'editable') },
  });

  const errors: Error[] = [];
  const reader = createReadingView(document, editor, (error) => errors.push(error));
  reader.enable(true);
  document.body.append(reader.element);
  onTestFinished(() => {
    reader.destroy();
    editor.destroy();
  });
  expect(reader.element.textContent).toBe('Protected contentPublic');
  expect(reads).toBe(0);
  access = 'read-only';
  editor.refreshPermissions();
  const heading = reader.element.querySelector('h3');
  expect(heading?.textContent).toBe('Secret heading');
  expect(heading?.getAttribute('aria-description')).toBe('Read-only block.');
  editor.select(textSelection(3, 0));
  heading?.click();
  expect(editor.state.selection).toEqual(textSelection(3, 0));
  access = 'editable';
  editor.refreshPermissions();
  expect(reader.element.querySelector('h3')).toBe(heading);
  heading?.click();
  expect(editor.state.selection).toEqual(textSelection(2, 0));
  access = 'protected';
  editor.refreshPermissions();
  expect(reader.element.textContent).toBe('Protected contentPublic');
  expect(reader.element.querySelector('h3')).toBeNull();
  expect(errors).toEqual([]);
});

test('inline alternatives are readable text without exposing object replacement characters', ({
  onTestFinished,
}) => {
  const editor = createEditor({
    schema,
    content: [
      {
        kind: 'paragraph',
        id: 1,
        text: 'Hello \ufffc!',
        inline: [
          createMention({
            id: 'person',
            index: 6,
            label: 'Ada',
            width: 60,
            ascent: 24,
            descent: 6,
          }),
        ],
      },
    ],
  });

  const errors: Error[] = [];
  const reader = createReadingView(document, editor, (error) => errors.push(error));
  onTestFinished(() => {
    reader.destroy();
    editor.destroy();
  });
  reader.enable(true);
  expect(reader.element.textContent).toContain('Ada');
  expect(reader.element.textContent).not.toContain('\ufffc');
  expect(errors).toEqual([]);
});
