import { defineExtension, type CommandDefinition, type ExtensionContext } from '@gprose/core';
import { createSchema, defineNode, type DocumentNode, type NodeIdentity } from '@gprose/model';
import { z } from 'zod';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

const append: CommandDefinition<DocumentNode<readonly [typeof note]>, [string]> = {
  activity: ({ state }, text) => (state.nodes[0].text.endsWith(text) ? 'active' : 'inactive'),
  execute(context, text) {
    const node = context.state.nodes[0];
    context.step({
      kind: 'replaceText',
      id: node.id,
      from: node.text.length,
      to: node.text.length,
      text,
    });

    return true;
  },
};

export function ownershipFixture() {
  const events: string[] = [];

  const lifetime = defineExtension({
    name: 'lifetime',
    options: {},
    setup(_options, { onDestroy }: Pick<ExtensionContext<NodeIdentity>, 'onDestroy'>) {
      events.push('create');
      onDestroy(() => events.push('destroy'));

      return { commands: { append } };
    },
  });

  return { schema: createSchema({ extensions: [note, lifetime] }), events };
}
