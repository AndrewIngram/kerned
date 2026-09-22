import { defineContribution, type Editor, type EditorViewSession } from '@gprose/core';
import type { NodeIdentity, Schema, SchemaDefinition } from '@gprose/model';

import type { BrowserViewOptions } from './native-view.js';
import type { createTextInput } from './text-input.js';

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
    | 'positions'
    | 'find'
    | 'getNode'
    | 'getAccess'
    | 'getSelection'
  > & { readonly schema: Schema<N> };

export type InputContribution = {
  create<N extends NodeIdentity>(context: {
    editor: ViewSession<N>;
    input: HTMLTextAreaElement;
    textInput: ReturnType<typeof createTextInput<N>>;
    navigate: (event: KeyboardEvent) => boolean;
    selectAll: () => void;
    notice: (message: string) => void;
  }): Omit<
    NonNullable<BrowserViewOptions['input']>,
    'element' | 'focus' | 'compositionstart' | 'compositionend'
  > & {
    afterComposition?(): void;
    destroy?(): void;
  };
};

export const inputPolicies = defineContribution<InputContribution>();
