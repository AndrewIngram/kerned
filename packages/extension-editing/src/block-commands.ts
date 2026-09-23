import { indexTree, type Schema, type NodeIdentity } from '@kerned/model';
import type { EditorState } from '@kerned/state';
import type { Step } from '@kerned/transform';

import { createListCommands, type ListAdapter } from './lists.js';

/** Structural policy supplies constructors and predicates; the document's schema
 * owns child storage, including foreign content nested inside these wrappers. */
export function createBlockCommands<N extends NodeIdentity>(adapter: {
  list: ListAdapter<N>;
  isQuote(this: void, node: N): boolean;
  createQuote(identity: NodeIdentity): N;
  withOrdered(node: N, ordered: boolean): N;
}) {
  const listCommands = createListCommands(adapter.list);

  function flatten(schema: Schema<N>, node: N): N[] {
    return adapter.isQuote(node)
      ? schema.children(node).flatMap((child) => flatten(schema, child))
      : [node];
  }

  return function blockCommands(
    schema: Schema<N>,
    state: EditorState<N>,
    ids: number[],
    allocate: () => NodeIdentity,
    tree = indexTree(schema, state.nodes),
  ) {
    const entries = ids.flatMap((id) => {
      const entry = tree.byId.get(id);

      return entry ? [entry] : [];
    });

    const first = entries[0];

    function ancestor(matches: (node: N) => boolean) {
      let entry: typeof first | undefined = first;

      while (entry) {
        if (matches(entry.node)) return entry;
        entry = entry.parent === null ? undefined : tree.byId.get(entry.parent);
      }

      return undefined;
    }

    function siblings() {
      if (!first || entries.some((e) => e.parent !== first.parent)) return null;

      const indexes = entries.map((e) => e.index),
        index = Math.min(...indexes),
        last = Math.max(...indexes);

      return { parent: first.parent, index, count: last - index + 1 };
    }

    return {
      item: ancestor((node) => adapter.list.item(node) !== null)?.node.id,
      quoted:
        entries.length > 0 &&
        entries.every((entry) => {
          while (entry) {
            if (adapter.isQuote(entry.node)) return true;
            const parent = entry.parent === null ? undefined : tree.byId.get(entry.parent);

            if (!parent) return false;
            entry = parent;
          }

          return false;
        }),
      quote(): Step<N>[] {
        if (!entries.length) return [];

        const ancestors = (id: number) => {
          const result: number[] = [];
          let entry = tree.byId.get(id);

          while (entry) {
            result.push(entry.node.id);
            entry = entry.parent === null ? undefined : tree.byId.get(entry.parent);
          }

          return result;
        };

        const paths = entries.map((entry) => ancestors(entry.node.id));
        const existing = ancestor(adapter.isQuote);

        if (existing && paths.every((path) => path.includes(existing.node.id)))
          return [{ kind: 'unwrap', id: existing.node.id }];

        // Lift the range to its nearest shared container. A list remains a list inside
        // the quote, and existing quotes in the range contribute their children.
        let parent =
          paths[0].slice(1).find((id) => paths.every((path) => path.slice(1).includes(id))) ?? null;

        // List items must remain children of their list. A selection spanning items
        // therefore quotes the list as a whole, not its item records.
        while (parent !== null) {
          const entry = tree.byId.get(parent);

          if (!entry || !adapter.list.list(entry.node)) break;
          parent = entry.parent;
        }

        const children =
          parent === null ? state.nodes : schema.children(tree.byId.get(parent)!.node);

        const childIndexes = new Map(children.map((node, index) => [node.id, index]));

        const indexes = paths.flatMap((path) =>
          path.flatMap((id) => {
            const index = childIndexes.get(id);

            return index === undefined ? [] : [index];
          }),
        );

        const index = Math.min(...indexes),
          last = Math.max(...indexes);

        return [
          {
            kind: 'replaceChildren',
            parent,
            index,
            count: last - index + 1,
            nodes: [
              schema.withChildren(
                adapter.createQuote(allocate()),
                children.slice(index, last + 1).flatMap((node) => flatten(schema, node)),
              ),
            ],
          },
        ];
      },
      list(ordered: boolean): Step<N>[] {
        const existing = ancestor((node) => adapter.list.list(node) !== null);

        const settings = existing ? adapter.list.list(existing.node) : null;

        if (existing && settings) {
          if (settings.ordered !== ordered)
            return [{ kind: 'updateBlock', node: adapter.withOrdered(existing.node, ordered) }];

          return [
            ...settings.children.map((item) => ({ kind: 'unwrap' as const, id: item.id })),
            { kind: 'unwrap', id: existing.node.id },
          ];
        }

        const range = siblings();

        if (!range) return [];

        return listCommands.wrap(
          schema,
          state,
          range.parent,
          range.index,
          range.count,
          { ordered, start: 1 },
          allocate,
        ).steps;
      },
    };
  };
}
