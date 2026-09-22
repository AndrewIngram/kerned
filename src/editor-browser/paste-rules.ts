import { defineContribution, type CommandContext } from '../core';
import type { NodeIdentity } from '../model';
import type { ViewSession } from './input-contributions';

export type ClipboardData = {
  readonly types: readonly string[];
  getData(type: string): string;
};

export type PasteRule = {
  readonly priority?: number;
  /** True owns this paste. False discards the draft before the next rule or
   * ordinary rich/plain paste. Use transaction.effect for committed effects. */
  run<N extends NodeIdentity>(options: {
    transaction: CommandContext<N>;
    clipboard: ClipboardData;
  }): boolean;
};

export const pasteRules = defineContribution<PasteRule>();

/** Transactional clipboard interception shared by canvas and native node views.
 * It installs no listener and does not change the source DataTransfer. */
export function createPasteRules<N extends NodeIdentity>(editor: ViewSession<N>) {
  const rules = pasteRules
    .read(editor)
    .map((rule) => {
      const priority = rule.priority ?? 0;

      if (!Number.isFinite(priority)) throw new Error('Paste rule priority must be finite');

      return { rule, priority };
    })
    .toSorted((a, b) => b.priority - a.priority);

  return (data: ClipboardData): boolean => {
    if (editor.isDestroyed) throw new Error('Editor is destroyed');

    if (!rules.length) return false;
    const values = new Map<string, string>();

    const clipboard: ClipboardData = {
      types: Object.freeze([...data.types]),
      getData(type) {
        const value = values.get(type);

        if (value !== undefined) return value;
        const content = data.getData(type);
        values.set(type, content);

        return content;
      },
    };

    for (const { rule } of rules)
      if (editor.transact((transaction) => rule.run({ transaction, clipboard }))) return true;

    return false;
  };
}
