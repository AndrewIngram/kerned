import { indexTree, type NodeIdentity, type Schema } from '@gprose/model';
import { TextSelection, textSelection, selectionContext, type EditorState } from '@gprose/state';
import { type Step } from '@gprose/transform';

import { replaceStructuredText } from './blocks';
import { paragraph } from './starter-definitions';

/** Plain-text clipboard paragraphs, inserted together as one undoable transaction. */
export function pasteParagraphs<N extends NodeIdentity>(
  schema: Schema<N>,
  state: EditorState<N>,
  text: string,
  allocate: () => NodeIdentity,
) {
  const lines = text.split('\n');

  const replacement =
    state.selection instanceof TextSelection &&
    state.selection.anchor.id === state.selection.head.id
      ? state.selection.replace(selectionContext(schema, state.nodes), lines[0])
      : replaceStructuredText(schema, state, lines[0]);

  if (lines.length === 1) return replacement;
  const caret = replacement.selection;

  if (!(caret instanceof TextSelection)) throw new Error('Text replacement must return a caret');
  const entry = indexTree(schema, state.nodes).byId.get(caret.head.id);

  if (!entry) throw new Error('Missing paste destination');

  const tail = allocate(),
    last = lines[lines.length - 1];

  const paragraphs = schema.node(paragraph);
  const middle = lines.slice(1, -1).map((value) => paragraphs.create(allocate(), { text: value }));

  const steps: Step<N>[] = [
    ...replacement.steps,
    {
      kind: 'split',
      id: caret.head.id,
      at: caret.head.offset,
      rightId: tail.id,
      rightKey: tail.key,
    },
    { kind: 'replaceText', id: tail.id, from: 0, to: 0, text: last },
  ];

  if (middle.length)
    steps.push({
      kind: 'insertChildren',
      parent: entry.parent,
      index: entry.index + 1,
      nodes: middle,
    });

  return { steps, selection: textSelection(tail.id, last.length) };
}
