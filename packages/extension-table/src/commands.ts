import {
  defineCommand,
  defineExtension,
  defineQuery,
  type ReadContext,
  type CommandContext,
} from '@gprose/core';
import { paragraph } from '@gprose/extension-document';
import { indexTree, type NodeIdentity } from '@gprose/model';
import { TextSelection, RangeSelection, textSelection, selectionContext } from '@gprose/state';

import { table } from './definitions.js';
import { appendTableColumn, appendTableRow, createTable, tableCells } from './table.js';

function tableSelection<N extends NodeIdentity>(context: ReadContext<N>) {
  const tree = indexTree(context.schema, context.state.nodes);
  const selection = context.state.selection;

  const id =
    selection instanceof tableCells.CellSelection
      ? selection.tableId
      : selection instanceof TextSelection || selection instanceof RangeSelection
        ? selection.head.id
        : selection.ranges(selectionContext(context.schema, context.state.nodes, tree))[0]?.id;

  let entry = id === undefined ? undefined : tree.byId.get(id);
  const tableType = context.schema.node(table);

  while (entry && !tableType.matches(entry.node))
    entry = entry.parent === null ? undefined : tree.byId.get(entry.parent);

  return { tree, id, entry };
}

function changeTable<N extends NodeIdentity>(context: CommandContext<N>, column: boolean) {
  const { entry } = tableSelection(context);

  if (!entry) return false;

  const node = (column ? appendTableColumn : appendTableRow)(
    context.schema,
    entry.node,
    context.allocate,
  );

  context.step({
    kind: 'replaceChildren',
    parent: entry.parent,
    index: entry.index,
    count: 1,
    nodes: [node],
  });

  return true;
}

export const tableEditing = defineExtension({
  name: 'tableEditing',
  options: {},
  requires: ['paragraph', 'table', 'tableCell'],
  setup: () => ({
    selections: [tableCells.extension],
    commands: {
      insertTable: defineCommand({
        execute(context) {
          const { tree, id } = tableSelection(context);
          let entry = id === undefined ? undefined : tree.byId.get(id);

          while (entry?.parent != null) entry = tree.byId.get(entry.parent);

          if (!entry) return false;
          const node = createTable(context.schema, context.allocate);
          const after = context.schema.node(paragraph).create(context.allocate(), { text: '' });
          context.apply({
            steps: [
              {
                kind: 'insertChildren',
                parent: null,
                index: entry.index + 1,
                nodes: [node, after],
              },
            ],
            selection: textSelection(after.id, 0),
          });

          return true;
        },
      }),
      addTableRow: defineCommand({ execute: (context) => changeTable(context, false) }),
      addTableColumn: defineCommand({ execute: (context) => changeTable(context, true) }),
    },
    queries: {
      selectedTable: defineQuery((context) => {
        const { entry } = tableSelection(context);

        return entry ? { id: entry.node.id, key: entry.node.key } : null;
      }),
    },
  }),
});
