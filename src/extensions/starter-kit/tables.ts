import {
  defineCommand,
  defineExtension,
  defineQuery,
  type ReadContext,
  type CommandContext,
} from '@gprose/core';
import type { NodeIdentity } from '@gprose/model';
import { TextSelection, RangeSelection, textSelection } from '@gprose/state';

import { paragraph, table } from '../starter-definitions';
import { appendTableColumn, appendTableRow, createTable, tableCells } from '../table';
import { selectedStructure } from './selection';

function tableSelection<N extends NodeIdentity>(context: ReadContext<N>) {
  const selected = selectedStructure(context);
  const selection = context.state.selection;

  const id =
    selection instanceof tableCells.CellSelection
      ? selection.tableId
      : selection instanceof TextSelection || selection instanceof RangeSelection
        ? selection.head.id
        : selected.ids[0];

  return {
    selected,
    id,
    entry: id === undefined ? undefined : selected.ancestor(id, context.schema.node(table).matches),
  };
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

export const starterTables = defineExtension({
  name: 'starterTables',
  options: {},
  requires: ['paragraph', 'table', 'tableCell'],
  setup: () => ({
    selections: [tableCells.extension],
    commands: {
      insertTable: defineCommand({
        execute(context) {
          const { selected, id } = tableSelection(context);
          let entry = id === undefined ? undefined : selected.tree.byId.get(id);

          while (entry?.parent != null) entry = selected.tree.byId.get(entry.parent);

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
