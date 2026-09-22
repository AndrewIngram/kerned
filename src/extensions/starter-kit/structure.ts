import { defineCommand, defineExtension, defineQuery, type ReadContext } from '@gprose/core';
import { quote, list, listItem } from '@gprose/extension-document';
import { type NodeIdentity, type Schema } from '@gprose/model';

import { createBlockCommands } from '../block-commands';
import type { HeadingLevel } from '../demo-model';
import { setTextBlockType } from '../headings';
import { createListCommands, type ListAdapter } from '../lists';
import { selectedStructure } from './selection';

/** Bind constructors to the executing schema so wrappers can retain foreign children. */
export function createStructuralPolicies<N extends NodeIdentity>(schema: Schema<N>) {
  const quoteType = schema.node(quote);
  const listType = schema.node(list);
  const itemType = schema.node(listItem);

  const adapter: ListAdapter<N> = {
    list(node) {
      const attrs = listType.read(node);

      return attrs ? { ...attrs, children: schema.children(node) } : null;
    },
    item: (node) => (itemType.matches(node) ? { children: schema.children(node) } : null),
    isBlock: (node) => schema.resolve(node).groups?.includes('block') ?? false,
    createList: (identity, settings) => listType.create(identity, settings),
    createItem: (identity) => itemType.create(identity, {}),
  };

  return {
    itemType,
    lists: createListCommands(adapter),
    blocks: createBlockCommands({
      list: adapter,
      isQuote: quoteType.matches,
      createQuote: (identity) => quoteType.create(identity, {}),
      withOrdered(node, ordered) {
        const attrs = listType.read(node);

        if (!attrs) throw new Error('Expected list');

        return listType.create(node, { ...attrs, ordered }, schema.children(node));
      },
    }),
  };
}

function quoteActivity<N extends NodeIdentity>(context: ReadContext<N>) {
  const selected = selectedStructure(context);
  const quoteType = context.schema.node(quote);
  const values = selected.ids.map((id) => !!selected.ancestor(id, quoteType.matches));

  return values.some(Boolean) ? (values.every(Boolean) ? 'active' : 'mixed') : 'inactive';
}

export const structureCommands = {
  setHeading: defineCommand({
    execute(context, level: HeadingLevel | null) {
      const selected = selectedStructure(context);

      const steps = setTextBlockType(
        context.schema,
        context.state,
        selected.ids,
        level,
        selected.tree,
      );

      if (!steps.length) return false;
      context.steps(steps);

      return true;
    },
  }),
  toggleQuote: defineCommand({
    execute(context) {
      const selected = selectedStructure(context);

      const steps = createStructuralPolicies(context.schema)
        .blocks(context.schema, context.state, selected.ids, context.allocate, selected.tree)
        .quote();

      if (!steps.length) return false;
      context.steps(steps);

      return true;
    },
    activity: quoteActivity,
  }),
  toggleList: defineCommand({
    execute(context, ordered: boolean) {
      const selected = selectedStructure(context);

      const steps = createStructuralPolicies(context.schema)
        .blocks(context.schema, context.state, selected.ids, context.allocate, selected.tree)
        .list(ordered);

      if (!steps.length) return false;
      context.steps(steps);

      return true;
    },
  }),
  indentList: defineCommand({
    execute(context, outdent = false) {
      const selected = selectedStructure(context);
      const policy = createStructuralPolicies(context.schema);
      const first = selected.ids[0];

      const item =
        first === undefined ? undefined : selected.ancestor(first, policy.itemType.matches);

      if (!item || (!outdent && item.index === 0)) return false;

      const change = (outdent ? policy.lists.outdent : policy.lists.indent)(
        context.schema,
        context.state,
        item.node.id,
        context.allocate,
      );

      context.apply(change);

      return true;
    },
  }),
};

export const structureQueries = {
  blockState: defineQuery((context) => {
    const selected = selectedStructure(context);
    const first = selected.ids[0];
    const itemType = context.schema.node(listItem);

    return {
      item: first === undefined ? undefined : selected.ancestor(first, itemType.matches)?.node.id,
      quoted: quoteActivity(context) === 'active',
    };
  }),
};

export const starterStructure = defineExtension({
  name: 'starterStructure',
  options: {},
  requires: ['paragraph', 'heading', 'quote', 'list', 'listItem'],
  setup: () => ({
    commands: structureCommands,
    queries: structureQueries,
  }),
});
