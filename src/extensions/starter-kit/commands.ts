import {
  defineExtension,
  type CommandContext,
  type CommandDefinition,
  type ExtensionContext,
} from '../../core';
import {
  AllSelection,
  NodeSelection,
  RangeSelection,
  TextSelection,
  selectionContext,
} from '../../state';
import { type Step } from '../../transform';
import { replaceStructuredText } from '../blocks';
import { pasteFragment, type ClipboardFragment } from '../clipboard';
import type { StarterNode } from '../demo-model';

type Context = CommandContext<StarterNode>;

function apply(context: Context, steps: readonly Step<StarterNode>[]) {
  if (!steps.length) return false;
  context.steps(steps);

  return true;
}

/** Starter policies run against the current command draft, including nested edits. */
export const starterEditing = defineExtension({
  name: 'starterEditing',
  options: {},
  requires: ['paragraph', 'heading', 'list', 'quote', 'table'],
  setup(_options, { schema }: ExtensionContext<StarterNode>) {
    const commands = {
      updateNode: {
        execute: (context, node) => apply(context, [{ kind: 'updateBlock', node }]),
      } satisfies CommandDefinition<StarterNode, [StarterNode]>,
      selectAll: {
        execute(context) {
          context.select(new AllSelection());

          return true;
        },
      } satisfies CommandDefinition<StarterNode>,
      replaceSelection: {
        execute(context, text) {
          const current = context.state;
          const selectionContextValue = selectionContext(schema, current.nodes);
          const selection = current.selection;

          const needsParagraphs =
            text &&
            (selection instanceof NodeSelection ||
              selection instanceof AllSelection ||
              (selection instanceof RangeSelection &&
                (!selection.ranges(selectionContextValue).some((range) => range.kind === 'text') ||
                  text.includes('\n'))));

          const change = needsParagraphs
            ? pasteFragment(
                schema,
                current,
                {
                  inline: false,
                  nodes: text.split(/\r?\n/).map((value) => ({
                    kind: 'paragraph',
                    ...context.allocate(),
                    text: value,
                    marks: [],
                    inline: [],
                  })),
                },
                () => context.allocate(),
              )
            : selection instanceof RangeSelection ||
                (selection instanceof TextSelection && selection.anchor.id !== selection.head.id)
              ? replaceStructuredText(schema, current, text)
              : selection.replace(selectionContextValue, text);

          context.apply(change);

          return true;
        },
      } satisfies CommandDefinition<StarterNode, [string]>,
      paste: {
        execute(context, fragment) {
          const change = pasteFragment(schema, context.state, fragment, () => context.allocate());
          context.apply(change);

          return true;
        },
      } satisfies CommandDefinition<StarterNode, [ClipboardFragment]>,
    };

    return { commands };
  },
});
