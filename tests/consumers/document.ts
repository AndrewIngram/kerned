import { defineCommand, defineExtension, type ContributionContext } from '@kerned/core';
import { defineNode } from '@kerned/model';
import { TextSelection, textSelection } from '@kerned/state';
import { defineNodePresentation, inputPolicies, presentations } from '@kerned/view';
import { z } from 'zod';

export const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block', 'textblock'],
    attributes: z.strictObject({ body: z.string() }),
    content: { kind: 'text', field: 'body' },
  }),
});

const append = defineCommand<[string]>({
  execute(context, text) {
    const node = context.state.nodes[0];
    const attributes = context.schema.node(note).read(node);

    if (!attributes) return false;
    context.step({
      kind: 'replaceText',
      id: node.id,
      from: attributes.body.length,
      to: attributes.body.length,
      text,
    });

    return true;
  },
});

export const editing = defineExtension({
  name: 'editing',
  options: {},
  requires: [note.name],
  setup: () => ({ commands: { append } }),
});

export const presentation = defineExtension({
  name: 'presentation',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(
      presentations,
      defineNodePresentation(note, () => (attributes) => ({
        kind: 'text',
        text: attributes.body,
        size: 18,
        lineHeight: 28,
        before: 0,
        after: 16,
        baselineGrid: 4,
        spans: [],
        atoms: [],
      })),
    );
    context.provide(inputPolicies, {
      create({ editor, input, textInput }) {
        return {
          input() {
            textInput.read(input, (from, to, text) => {
              const selection = editor.state.selection;

              if (!(selection instanceof TextSelection)) return;
              const id = selection.head.id;

              const applied = editor.transact((draft) => {
                draft.step({ kind: 'replaceText', id, from, to, text });
                draft.select(textSelection(id, from + text.length));

                return true;
              });

              if (!applied) textInput.sync(input);
            });
          },
        };
      },
    });

    return {};
  },
});
