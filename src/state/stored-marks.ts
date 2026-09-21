import {
  type Mark,
  marksAt,
  type NodeIdentity,
  type Schema,
  type TreeIndex,
  indexTree,
} from '../model';
import { TextSelection } from './selection';
import type { EditorState } from './transactions';

export function inputMarks<N extends NodeIdentity>(
  schema: Schema<N>,
  state: EditorState<N>,
  tree?: TreeIndex<N>,
): readonly Mark[] {
  if (state.storedMarks != null) return state.storedMarks;

  if (!(state.selection instanceof TextSelection)) return [];
  const { anchor, head } = state.selection;
  tree ??= indexTree(schema, state.nodes);

  if (anchor.id === head.id) {
    const node = tree.byId.get(anchor.id)?.node;

    return node
      ? marksAt(
          schema,
          node,
          Math.min(anchor.offset, head.offset),
          anchor.offset === head.offset ? 'left' : 'right',
        )
      : [];
  }

  const order = tree.order,
    ai = order.findIndex((entry) => entry.node.id === anchor.id),
    hi = order.findIndex((entry) => entry.node.id === head.id);

  const point = ai < hi || (ai === hi && anchor.offset < head.offset) ? anchor : head,
    node = tree.byId.get(point.id)?.node;

  return node
    ? marksAt(
        schema,
        node,
        point.offset,
        anchor.id === head.id && anchor.offset === head.offset ? 'left' : 'right',
      )
    : [];
}
