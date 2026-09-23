import { defineExtension, createInputRules, type ContributionContext } from '@kerned/core';
import { replaceText } from '@kerned/extension-document';
import type { NodeIdentity } from '@kerned/model';
import { selectionContext } from '@kerned/state';
import { viewStyles } from '@kerned/view';
import { createKeyboardShortcuts } from '@kerned/view';
import { nodeViews, type NodeViewContext, type NodeViewFrame } from '@kerned/view';

import { table } from './definitions.js';
import { tableStyles } from './table-view-styles.js';
import { createTableView } from './table-view.js';
import { tableCells } from './table.js';

/** Grid interaction belongs to the table extension; the mount supplies shared clipboard policy. */
export const tableView = defineExtension({
  name: 'tableView',
  options: {},
  requires: ['table', 'tableCell', 'tableEditing'],
  setup(_options, context: ContributionContext) {
    context.provide(viewStyles, tableStyles);
    context.provide(nodeViews, {
      create<N extends NodeIdentity>({ editor, clipboard, notice }: NodeViewContext<N>) {
        const rules = createInputRules(editor);
        const shortcuts = createKeyboardShortcuts(editor);
        const binding = editor.schema.node(table);

        function run(action: () => boolean) {
          try {
            const applied = action();
            notice('');

            return applied;
          } catch (error) {
            notice(error instanceof Error ? error.message : String(error));

            return false;
          }
        }

        return {
          name: table.name,
          matches: binding.matches,
          mount(element) {
            const view = createTableView(element, editor.schema);

            return {
              update(frame: NodeViewFrame<N>) {
                if (!frame.textStyle) throw new Error('Table views require resolved text styles');
                view.update({
                  ...frame,
                  textStyle: frame.textStyle,
                  access: (id) => editor.getAccess(id),
                  onSelect: (selection) => editor.select(selection),
                  onText: (id, from, to, text, caret, { composing, pasted }) => {
                    const applied = run(() =>
                      editor.transact(
                        (draft) => draft.command(replaceText, { id, from, to, text, caret }),
                        {
                          history: pasted
                            ? 'separate'
                            : { group: `${composing ? 'composition' : 'typing'}:${id}` },
                        },
                      ),
                    );

                    // A rejected transformation must not roll back accepted literal input.
                    if (applied && !pasted) run(() => rules.input({ text, composing }));

                    return applied;
                  },
                  onComposition: () => editor.breakHistory(),
                  afterComposition: () => {
                    run(() => rules.endComposition());
                  },
                  onKeyDown: (event) => run(() => shortcuts(event)),
                  onReplace: (text) =>
                    run(() =>
                      editor.transact((draft) => {
                        const selection = draft.state.selection;

                        if (!(selection instanceof tableCells.CellSelection)) return false;
                        draft.apply(
                          selection.replace(
                            selectionContext(draft.schema, draft.state.nodes),
                            text,
                          ),
                        );

                        return true;
                      }),
                    ),
                  clipboard: { copy: clipboard, cut: clipboard, paste: clipboard },
                });
              },
              focusSelection: (selection) => view.focusSelection(selection),
              coordsAt: (point) => view.coordsAt(point),
              reveal: (point) => view.reveal(point),
              destroy: () => view.destroy(),
            };
          },
        };
      },
    });

    return {};
  },
});

export { tableHtmlParsers } from './html-parsers.js';

export { tablePresentation } from './presentation.js';
