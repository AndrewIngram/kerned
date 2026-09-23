import {
  hasMark,
  sameMark,
  type Mark,
  type NodeIdentity,
  type Schema,
  indexTree,
} from '@kerned/model';

import type { CommandActivity, CommandDefinition } from './commands.js';
import { changeSelectionMarks } from './mark-commands.js';
import { TextSelection, selectionContext } from './selection.js';
import { inputMarks } from './stored-marks.js';
import type { EditorState } from './transactions.js';

export function markActivity<N extends NodeIdentity>(
  schema: Schema<N>,
  state: EditorState<N>,
  mark: Mark,
  tree = indexTree(schema, state.nodes),
): CommandActivity {
  const selection = state.selection;

  if (
    selection instanceof TextSelection &&
    selection.anchor.id === selection.head.id &&
    selection.anchor.offset === selection.head.offset
  )
    return inputMarks(schema, state, tree).some((value) => sameMark(value, mark))
      ? 'active'
      : 'inactive';

  let any = false,
    all = true,
    count = 0;

  for (const range of selection.ranges(selectionContext(schema, state.nodes, tree))) {
    if (range.kind !== 'text' || range.from === range.to) continue;

    const node = tree.byId.get(range.id)?.node,
      ranges = node ? (schema.editing(node).marks?.read(node) ?? []) : [];

    count++;
    all = all && hasMark(ranges, range.from, range.to, mark);
    any =
      any ||
      ranges.some(
        (value) => value.from < range.to && value.to > range.from && sameMark(value.mark, mark),
      );

    if (any && !all) return 'mixed';
  }

  return count && all ? 'active' : any ? 'mixed' : 'inactive';
}

export function toggleMarkCommand<N extends NodeIdentity>(
  schema: Schema<N>,
  mark: Mark,
): CommandDefinition<N> {
  return {
    activity: ({ state }) => markActivity(schema, state, mark),
    execute(context) {
      const { state } = context,
        selection = state.selection,
        tree = indexTree(schema, state.nodes),
        enabled = markActivity(schema, state, mark, tree) !== 'active';

      if (
        selection instanceof TextSelection &&
        selection.anchor.id === selection.head.id &&
        selection.anchor.offset === selection.head.offset
      ) {
        const node = tree.byId.get(selection.head.id)?.node;

        if (!node || !schema.editing(node).marks) return false;
        const marks = inputMarks(schema, state, tree).filter((value) => value.type !== mark.type);
        context.storedMarks(enabled ? [...marks, mark] : marks);

        return true;
      }

      const steps = changeSelectionMarks(
        schema,
        state,
        enabled ? { kind: 'set', mark } : { kind: 'remove', type: mark.type },
        tree,
      );

      if (!steps.length) return false;
      context.steps(steps);

      return true;
    },
  };
}
