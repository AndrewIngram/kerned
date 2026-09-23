import { snapTextOffset, type NodeIdentity, type SchemaDefinition } from '@kerned/model';
import { TextSelection, type CommandContext } from '@kerned/state';

import { defineContribution } from './contributions.js';
import type { Editor } from './session.js';

export type InputRule = {
  /** Matched against text before the caret, with an implicit end-of-text anchor. */
  readonly find: RegExp;
  readonly priority?: number;
  /** False discards the entire draft and tries the next matching rule. */
  run<N extends NodeIdentity>(options: {
    transaction: CommandContext<N>;
    range: { readonly id: number; readonly from: number; readonly to: number };
    match: RegExpExecArray;
  }): boolean;
};

export const inputRules = defineContribution<InputRule>();

type InputRuleSession<N extends NodeIdentity> = Pick<
  Editor<readonly SchemaDefinition[], N>,
  'state' | 'isDestroyed' | 'getNode' | 'transact'
> & { readonly schema: CommandContext<N>['schema'] };

/** Call after successful native text insertion. A transformation is a separate
 * history entry: Undo first restores the literal input, then earlier typing.
 * Ordinary commands and paste do not implicitly run input rules. */
export function createInputRules<N extends NodeIdentity>(editor: InputRuleSession<N>) {
  const rules = inputRules
    .read(editor)
    .map((rule) => {
      const priority = rule.priority ?? 0;

      if (!Number.isFinite(priority)) throw new Error('Input rule priority must be finite');

      return {
        rule,
        priority,
        // A terminal negative lookahead remains an absolute end anchor with /m.
        find: new RegExp(
          `(?:${rule.find.source})(?![\\s\\S])`,
          rule.find.flags.replace(/[gy]/g, ''),
        ),
      };
    })
    .toSorted((a, b) => b.priority - a.priority);

  let pending: { revision: number; selection: TextSelection } | undefined;

  function apply() {
    const { selection } = editor.state;

    if (
      !rules.length ||
      !(selection instanceof TextSelection) ||
      selection.anchor.id !== selection.head.id ||
      selection.anchor.offset !== selection.head.offset
    )
      return false;
    const node = editor.getNode(selection.head.id);

    if (!node) return false;
    const text = editor.schema.text(node);

    if (text === null) return false;
    const to = selection.head.offset;
    const before = text.slice(0, to);

    for (const { rule, find } of rules) {
      const match = find.exec(before);

      if (!match?.[0] || snapTextOffset(text, match.index, -1) !== match.index) continue;
      const range = { id: node.id, from: match.index, to };

      if (editor.transact((transaction) => rule.run({ transaction, range, match }))) return true;
    }

    return false;
  }

  return {
    input({ text, composing = false }: { text: string; composing?: boolean }) {
      if (editor.isDestroyed) throw new Error('Editor is destroyed');
      pending = undefined;

      if (!rules.length || !text) return false;

      if (composing) {
        const { revision, selection } = editor.state;

        if (selection instanceof TextSelection) pending = { revision, selection };

        return false;
      }

      return apply();
    },
    /** The browser adapter calls after final composition input has been delivered. */
    endComposition() {
      if (editor.isDestroyed) throw new Error('Editor is destroyed');
      const target = pending;
      pending = undefined;

      if (
        !target ||
        target.revision !== editor.state.revision ||
        !target.selection.eq(editor.state.selection)
      )
        return false;

      return apply();
    },
  };
}
