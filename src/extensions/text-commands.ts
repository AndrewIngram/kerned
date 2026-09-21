import { sameMark, type Schema, type NodeIdentity, indexTree } from '../model';
import {
  markActivity,
  inputMarks,
  TextSelection,
  changeSelectionMarks,
  selectionHasMark,
  selectionContext,
  type EditorState,
} from '../state';
import { type Step } from '../transform';
import type { TextFormat } from './formatting';

/** Extension commands return ordinary transactions; the core owns history/mapping. */
export function textCommands<N extends NodeIdentity>(
  schema: Schema<N>,
  state: EditorState<N>,
  tree = indexTree(schema, state.nodes),
) {
  const ranges = state.selection
    .ranges(selectionContext(schema, state.nodes, tree))
    .flatMap((range) => {
      const node = tree.byId.get(range.id)?.node;

      return range.kind === 'text' &&
        range.from < range.to &&
        node &&
        schema.resolve(node).kind === 'text' &&
        schema.editing(node).marks
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
      ? current.some((mark) => sameMark(mark, { type: key, attrs: null }))
      : selectionHasMark(schema, state, { type: key, attrs: null }, tree);

  return {
    available:
      ranges.length > 0 ||
      (!!caretNode &&
        schema.resolve(caretNode).kind === 'text' &&
        !!schema.editing(caretNode).marks),
    caret,
    current,
    active,
    activity: (key: TextFormat) => markActivity(schema, state, { type: key, attrs: null }, tree),
    toggle(key: TextFormat): Step<N>[] {
      const enabled = !active(key);

      return changeSelectionMarks(
        schema,
        state,
        enabled ? { kind: 'set', mark: { type: key, attrs: null } } : { kind: 'remove', type: key },
        tree,
      );
    },
    clear(): Step<N>[] {
      return changeSelectionMarks(schema, state, { kind: 'clear' }, tree);
    },
  };
}
