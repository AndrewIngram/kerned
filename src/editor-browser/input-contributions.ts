import { defineContribution, type Editor, type EditorViewSession } from '../core';
import type { NodeIdentity, Schema, SchemaDefinition } from '../model';
import type { createCanvasInput } from './canvas-input';
import type { BrowserViewOptions } from './index';

/** Extension input policies use the imperative session, not one consumer's command tuple. */
export type ViewSession<N extends NodeIdentity> = EditorViewSession &
  Pick<
    Editor<readonly SchemaDefinition[], N>,
    | 'state'
    | 'select'
    | 'subscribe'
    | 'transact'
    | 'breakHistory'
    | 'allocateBlockId'
    | 'on'
    | 'commands'
  > & { readonly schema: Schema<N> };

export type InputContribution = {
  create<N extends NodeIdentity>(context: {
    editor: ViewSession<N>;
    input: HTMLTextAreaElement;
    textInput: ReturnType<typeof createCanvasInput<N>>['textInput'];
    navigate: (event: KeyboardEvent) => boolean;
    selectAll: () => void;
    notice: (message: string) => void;
  }): Omit<
    NonNullable<BrowserViewOptions['input']>,
    'element' | 'focus' | 'compositionstart' | 'compositionend'
  > & {
    destroy?(): void;
  };
};

export const inputPolicies = defineContribution<InputContribution>();
