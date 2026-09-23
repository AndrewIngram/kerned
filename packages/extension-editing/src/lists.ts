import { indexTree, childrenAt, type NodeIdentity, type Schema } from '@kerned/model';
import { textSelection, type EditorState, type Selection } from '@kerned/state';
import { type Step } from '@kerned/transform';

export type ListSettings = { ordered: boolean; start: number };

export type ListAdapter<N extends NodeIdentity> = {
  list(node: N): ({ children: readonly N[] } & ListSettings) | null;
  item(node: N): { children: readonly N[] } | null;
  isBlock(node: N): boolean;
  createList(identity: NodeIdentity, settings: ListSettings): N;
  createItem(identity: NodeIdentity): N;
};

export type ListCommand<N extends NodeIdentity> = { steps: Step<N>[]; selection?: Selection };

/** List commands operate through schema-owned container operations. */
export function createListCommands<N extends NodeIdentity>(adapter: ListAdapter<N>) {
  function context(schema: Schema<N>, state: EditorState<N>, itemId: number) {
    const tree = indexTree(schema, state.nodes),
      item = tree.byId.get(itemId),
      parent = item?.parent === null ? undefined : tree.byId.get(item?.parent ?? NaN);

    if (!item || !adapter.item(item.node) || !parent || !adapter.list(parent.node))
      throw new Error('Expected a list item inside a list');
    const list = adapter.list(parent.node);

    if (!list) throw new Error('Expected list');

    return { tree, item, parent, list };
  }

  const commands = {
    wrap(
      schema: Schema<N>,
      state: EditorState<N>,
      parent: number | null,
      index: number,
      count: number,
      settings: ListSettings,
      allocate: () => NodeIdentity,
    ): ListCommand<N> {
      const children = childrenAt(schema, state.nodes, parent).slice(index, index + count);

      if (
        count < 1 ||
        children.length !== count ||
        children.some((child) => !adapter.isBlock(child))
      )
        throw new Error('Wrap requires block siblings');

      const items = children.map((node) =>
        schema.withChildren(adapter.createItem(allocate()), [node]),
      );

      const list = schema.withChildren(adapter.createList(allocate(), settings), items);

      return { steps: [{ kind: 'replaceChildren', parent, index, count, nodes: [list] }] };
    },
    indent(
      this: void,
      schema: Schema<N>,
      state: EditorState<N>,
      itemId: number,
      allocate: () => NodeIdentity,
    ): ListCommand<N> {
      const { item, parent, list } = context(schema, state, itemId);

      if (item.index === 0)
        throw new Error('First list item has no preceding item to indent beneath');

      const previous = list.children[item.index - 1],
        children = adapter.item(previous)?.children;

      if (!children) throw new Error('Previous sibling is not a list item');

      const last = children.at(-1),
        nested = last ? adapter.list(last) : null,
        steps: Step<N>[] = [];

      let target: number, index: number;

      if (last && nested && nested.ordered === list.ordered) {
        target = last.id;
        index = nested.children.length;
      } else {
        const created = adapter.createList(allocate(), { ordered: list.ordered, start: 1 });
        steps.push({
          kind: 'insertChildren',
          parent: previous.id,
          index: children.length,
          nodes: [created],
        });
        target = created.id;
        index = 0;
      }

      steps.push({
        kind: 'moveChildren',
        parent: parent.node.id,
        index: item.index,
        count: 1,
        toParent: target,
        toIndex: index,
      });

      return { steps };
    },
    outdent(
      this: void,
      schema: Schema<N>,
      state: EditorState<N>,
      itemId: number,
      allocate: () => NodeIdentity,
    ): ListCommand<N> {
      const { tree, item, parent, list } = context(schema, state, itemId),
        owner = parent.parent === null ? undefined : tree.byId.get(parent.parent),
        steps: Step<N>[] = [];

      if (owner && adapter.item(owner.node)) {
        const outer = owner.parent === null ? undefined : tree.byId.get(owner.parent);

        if (!outer || !adapter.list(outer.node))
          throw new Error('Nested list owner must belong to a list');
        steps.push({
          kind: 'moveChildren',
          parent: parent.node.id,
          index: item.index,
          count: 1,
          toParent: outer.node.id,
          toIndex: owner.index + 1,
        });

        if (list.children.length === 1)
          steps.push({
            kind: 'removeChildren',
            parent: owner.node.id,
            index: parent.index,
            count: 1,
          });
      } else {
        const trailing = list.children.length - item.index - 1;

        if (trailing) {
          const after = adapter.createList(allocate(), {
            ordered: list.ordered,
            start: list.start + item.index + 1,
          });

          steps.push({
            kind: 'insertChildren',
            parent: parent.parent,
            index: parent.index + 1,
            nodes: [after],
          });
          steps.push({
            kind: 'moveChildren',
            parent: parent.node.id,
            index: item.index + 1,
            count: trailing,
            toParent: after.id,
            toIndex: 0,
          });
        }

        steps.push({
          kind: 'moveChildren',
          parent: item.node.id,
          index: 0,
          count: schema.children(item.node).length,
          toParent: parent.parent,
          toIndex: parent.index + 1,
        });
        steps.push({ kind: 'removeChildren', parent: parent.node.id, index: item.index, count: 1 });

        if (item.index === 0)
          steps.push({
            kind: 'removeChildren',
            parent: parent.parent,
            index: parent.index,
            count: 1,
          });
      }

      return { steps };
    },
    enter(
      schema: Schema<N>,
      state: EditorState<N>,
      textId: number,
      at: number,
      allocate: () => NodeIdentity,
    ): ListCommand<N> {
      const tree = indexTree(schema, state.nodes),
        text = tree.byId.get(textId);

      if (!text || text.parent === null) throw new Error('Expected text in a list item');

      const { item, parent } = context(schema, state, text.parent),
        children = schema.children(item.node);

      if (schema.text(text.node) === '' && children.length === 1)
        return commands.outdent(schema, state, item.node.id, allocate);

      const right = allocate(),
        newItem = adapter.createItem(allocate());

      return {
        steps: [
          { kind: 'split', id: textId, at, rightId: right.id, rightKey: right.key },
          {
            kind: 'insertChildren',
            parent: parent.node.id,
            index: item.index + 1,
            nodes: [newItem],
          },
          {
            kind: 'moveChildren',
            parent: item.node.id,
            index: text.index + 1,
            count: children.length - text.index,
            toParent: newItem.id,
            toIndex: 0,
          },
        ],
        selection: textSelection(right.id, 0, 0),
      };
    },
    backspace(
      schema: Schema<N>,
      state: EditorState<N>,
      textId: number,
      allocate: () => NodeIdentity,
    ): ListCommand<N> {
      const tree = indexTree(schema, state.nodes),
        text = tree.byId.get(textId);

      if (!text || text.parent === null || text.index !== 0)
        throw new Error('Backspace command requires the first block in an item');
      const { item, parent, list } = context(schema, state, text.parent);

      if (item.index === 0) return commands.outdent(schema, state, item.node.id, allocate);

      const previous = list.children[item.index - 1],
        children = schema.children(previous),
        left = children.at(-1),
        moving = schema.children(item.node);

      const steps: Step<N>[] = [
        {
          kind: 'moveChildren',
          parent: item.node.id,
          index: 0,
          count: moving.length,
          toParent: previous.id,
          toIndex: children.length,
        },
        { kind: 'removeChildren', parent: parent.node.id, index: item.index, count: 1 },
      ];

      if (left && schema.text(left) !== null) {
        const at = schema.text(left)?.length ?? 0;
        steps.push({ kind: 'join', left: left.id, right: textId });

        return { steps, selection: textSelection(left.id, at, at) };
      }

      return { steps };
    },
    markers(schema: Schema<N>, nodes: readonly N[]) {
      const tree = indexTree(schema, nodes),
        result: { id: number; depth: number; label: string }[] = [];

      for (const entry of tree.order) {
        const list = adapter.list(entry.node);

        if (!list) continue;

        let depth = 0,
          parent = entry.parent;

        while (parent !== null) {
          const ancestor = tree.byId.get(parent);

          if (!ancestor) break;

          if (adapter.list(ancestor.node)) depth++;
          parent = ancestor.parent;
        }

        list.children.forEach((item, index) =>
          result.push({ id: item.id, depth, label: list.ordered ? `${list.start + index}.` : '•' }),
        );
      }

      return result;
    },
  };

  return commands;
}
