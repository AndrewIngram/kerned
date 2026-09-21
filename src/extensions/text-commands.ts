import {
  markActivity,
  inputMarks,
  sameMark,
  TextSelection,
  changeSelectionMarks,
  selectionHasMark,
  selectionContext,
  type EditorState,
  type Schema,
  type Step,
} from '../editor';
import { indexTree } from '../editor';
import type { StarterNode } from './demo-model';
import { formattingSchema, type TextFormat } from './formatting';

/** Extension commands return ordinary transactions; the core owns history/mapping. */
export function textCommands(
  schema: Schema<StarterNode>,
  state: EditorState<StarterNode>,
  tree = indexTree(schema, state.nodes),
) {
  const ranges = state.selection
    .ranges(selectionContext(schema, state.nodes, tree))
    .flatMap((range) => {
      const node = tree.byId.get(range.id)?.node;

      return range.kind === 'text' &&
        range.from < range.to &&
        (node?.kind === 'paragraph' || node?.kind === 'heading')
        ? [{ node, from: range.from, to: range.to }]
        : [];
    });

  const caret =
    state.selection instanceof TextSelection &&
    state.selection.anchor.id === state.selection.head.id &&
    state.selection.anchor.offset === state.selection.head.offset;

  const caretNode =
    caret && state.selection instanceof TextSelection
      ? tree.byId.get(state.selection.head.id)?.node
      : undefined;

  const current = caret ? inputMarks(schema, state, tree) : [];

  const active = (key: TextFormat) =>
    caret
      ? current.some((mark) => sameMark(mark, formattingSchema.create(key, null)))
      : selectionHasMark(schema, state, formattingSchema.create(key, null), tree);

  return {
    available:
      ranges.length > 0 ||
      (!!caretNode &&
        schema.resolve(caretNode).kind === 'text' &&
        !!schema.editing(caretNode).marks),
    caret,
    current,
    active,
    activity: (key: TextFormat) =>
      markActivity(schema, state, formattingSchema.create(key, null), tree),
    toggle(key: TextFormat): Step<StarterNode>[] {
      const enabled = !active(key);

      return changeSelectionMarks(
        schema,
        state,
        enabled
          ? { kind: 'set', mark: formattingSchema.create(key, null) }
          : { kind: 'remove', type: key },
        tree,
      );
    },
    clear(): Step<StarterNode>[] {
      return changeSelectionMarks(schema, state, { kind: 'clear' }, tree);
    },
  };
}
