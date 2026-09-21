import type { NodeIdentity } from '../model';
import type { createEditor, Selection } from '../state';
import { defineCommand } from './definitions';

/** Implemented by the mounted view; the session owns at most one attachment. */
export type EditorViewDelegate = {
  focus(): void;
  reveal(selection: Selection): void;
  destroy(): void;
};

export type EditorViewSession = { readonly isDestroyed: boolean };

const sessions = new WeakMap<EditorViewSession, ReturnType<typeof createViewEffects>>();

/** Adapter integration. Detaching a view does not destroy its session. */
export function connectEditorView(editor: EditorViewSession, view: EditorViewDelegate) {
  const effects = sessions.get(editor);

  if (!effects) throw new Error('Expected a composed editor session');

  return effects.attach(view);
}

export function registerViewEffects(
  editor: EditorViewSession,
  effects: ReturnType<typeof createViewEffects>,
) {
  sessions.set(editor, effects);
}

type Session = Pick<ReturnType<typeof createEditor<NodeIdentity>>, 'state' | 'isDestroyed'>;

export function createViewEffects(editor: Session) {
  let attached: { view: EditorViewDelegate } | null = null;

  return {
    attach(view: EditorViewDelegate) {
      if (editor.isDestroyed) throw new Error('Editor is destroyed');

      if (attached) throw new Error('An editor session supports one mounted view');
      const attachment = { view };
      attached = attachment;

      return () => {
        if (attached === attachment) attached = null;
      };
    },
    destroy() {
      const current = attached;
      attached = null;
      current?.view.destroy();
    },
    commands: {
      focus: defineCommand({
        execute(context) {
          const current = attached;
          context.effect(() => {
            if (current && attached === current && !editor.isDestroyed) current.view.focus();
          });

          return true;
        },
      }),
      scrollIntoView: defineCommand({
        execute(context) {
          const current = attached;
          context.effect(() => {
            if (current && attached === current && !editor.isDestroyed)
              current.view.reveal(editor.state.selection);
          });

          return true;
        },
      }),
    },
  };
}

export type ViewCommands = ReturnType<typeof createViewEffects>['commands'];
