import { createEditor, defineExtension, type ContributionContext } from '@gprose/core';
import { paragraph } from '@gprose/extension-document';
import { localHistory } from '@gprose/extension-history';
import { table, tableCell, tableEditing } from '@gprose/extension-table';
import { tableView, tableHtmlParsers } from '@gprose/extension-table/browser';
import { createSchema } from '@gprose/model';
import { textSelection } from '@gprose/state';
import {
  mountEditor,
  presentations,
  defineNodePresentation,
  createHtmlParser,
  defineHtmlTextParser,
} from '@gprose/view';

import { note, presentation } from './document';

const appearance = defineExtension({
  name: 'appearance',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(
      presentations,
      defineNodePresentation(table, () => () => ({
        kind: 'box',
        height: 80,
        before: 0,
        after: 16,
        baselineGrid: 4,
      })),
    );
    context.provide(
      presentations,
      defineNodePresentation(paragraph, () => (attrs) => ({
        kind: 'text',
        text: attrs.text,
        size: 18,
        lineHeight: 28,
        before: 0,
        after: 16,
        baselineGrid: 4,
        spans: [],
        atoms: [],
      })),
    );

    return {};
  },
});

const editor = createEditor({
  schema: createSchema({
    extensions: [
      note,
      paragraph,
      table,
      tableCell,
      tableEditing,
      localHistory,
      tableView,
      presentation,
      appearance,
    ],
  }),
  content: [
    {
      kind: 'table',
      id: 1,
      caption: 'Independent table',
      rows: [
        [
          {
            kind: 'tableCell',
            id: 2,
            row: 0,
            header: false,
            colspan: 1,
            rowspan: 1,
            paragraphs: [{ kind: 'note', id: 3, body: 'Native' }],
          },
        ],
      ],
    },
  ],
  selection: textSelection(3, 6),
});

const host = document.querySelector<HTMLElement>('#editor');

const output = document.querySelector('output');

const addRow = document.querySelector('#add-row');

const undo = document.querySelector('#undo');

const destroy = document.querySelector('#destroy');

if (!host || !output || !addRow || !undo || !destroy) throw new Error('Missing consumer hosts');

const stop = editor.subscribe(() => {
  const value = editor.state.nodes[0];

  if (value.kind !== 'table') throw new Error('Expected table');
  const first = value.rows[0][0].paragraphs[0];
  output.value = first.kind === 'note' ? first.body : first.text;
});

const parser = createHtmlParser(editor.schema, [
  defineHtmlTextParser(paragraph, {
    selector: 'p',
    fallback: true,
    attributes: (_element, text) => ({ text }),
  }),
  ...tableHtmlParsers,
]);

const imported = parser.parse(
  '<table><tr><td><table><tr><td>Nested</td><td>cells</td></tr></table></td></tr></table>',
)[0];

if (
  imported.kind !== 'table' ||
  imported.rows[0][0].paragraphs[0].kind !== 'paragraph' ||
  imported.rows[0][0].paragraphs[0].text !== 'Nested\tcells'
)
  throw new Error('Standalone nested table import changed text');

const view = mountEditor(host, { editor });

await view.ready;

editor.commands.focus();

host.dataset.ready = view.status;

addRow.addEventListener('click', () => editor.commands.addTableRow());

undo.addEventListener('click', () => editor.commands.undo());

destroy.addEventListener('click', () => {
  view.destroy();
  stop();
  editor.destroy();
  host.dataset.ready = 'destroyed';
});
