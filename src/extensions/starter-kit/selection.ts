import type { ReadContext } from '../../core';
import { indexTree, type NodeIdentity } from '../../model';
import { RangeSelection, TextSelection, selectionContext } from '../../state';

export function selectedStructure<N extends NodeIdentity>({ schema, state }: ReadContext<N>) {
  const tree = indexTree(schema, state.nodes);
  const context = selectionContext(schema, state.nodes, tree);
  const ranges = state.selection.ranges(context);
  const empty = state.selection.isEmpty(context);

  const textEndpoint =
    state.selection instanceof TextSelection || state.selection instanceof RangeSelection;

  const selected = ranges.filter(
    (range, index) =>
      !textEndpoint ||
      empty ||
      index !== ranges.length - 1 ||
      ranges.length === 1 ||
      range.kind === 'node' ||
      range.from !== 0 ||
      range.to !== 0,
  );

  function ancestor(id: number, matches: (node: N) => boolean) {
    let entry = tree.byId.get(id);

    while (entry) {
      if (matches(entry.node)) return entry;
      entry = entry.parent === null ? undefined : tree.byId.get(entry.parent);
    }

    return undefined;
  }

  return { tree, context, ids: selected.map((range) => range.id), ancestor };
}
