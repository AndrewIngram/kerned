import { defineCommand } from '@kerned/core';
import { TextSelection, textSelection } from '@kerned/state';

export type TextReplacementRange = { readonly from: number; readonly to: number };

export type TextReplacement = TextReplacementRange & {
  readonly id: number;
  readonly text: string;
  readonly caret?: number;
};

/** Explicit text targets support native controls whose diff includes a resulting caret. */
export const replaceText = defineCommand({
  execute(context, edit: TextReplacement) {
    const selection = context.state.selection;

    if (
      !(selection instanceof TextSelection) ||
      selection.anchor.id !== edit.id ||
      selection.head.id !== edit.id
    )
      context.select(textSelection(edit.id, edit.from, edit.to));
    context.apply({
      steps: [{ kind: 'replaceText', id: edit.id, from: edit.from, to: edit.to, text: edit.text }],
      selection: textSelection(edit.id, edit.caret ?? edit.from + edit.text.length),
      input: true,
    });

    return true;
  },
});
