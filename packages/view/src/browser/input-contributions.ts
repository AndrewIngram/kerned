import { defineContribution, type Editor, type EditorViewSession } from '@kerned/core';
import type { NodeIdentity, Schema, SchemaDefinition } from '@kerned/model';

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

/** Event policy supplied by extensions; element and composition ownership stay in the mount. */
export type InputHandlers = {
  keydown?: (event: KeyboardEvent) => void;
  input?: (event: Event, input: HTMLTextAreaElement) => void;
  copy?: (event: ClipboardEvent) => void;
  cut?: (event: ClipboardEvent) => void;
  paste?: (event: ClipboardEvent) => void;
};

export type InputContribution = {
  create<N extends NodeIdentity>(context: {
    editor: ViewSession<N>;
    input: HTMLTextAreaElement;
    textInput: ReturnType<typeof createTextInput<N>>;
    navigate: (event: KeyboardEvent) => boolean;
    selectAll: () => void;
    notice: (message: string) => void;
  }): InputHandlers & {
    afterComposition?(): void;
    destroy?(): void;
  };
};

export const inputPolicies = defineContribution<InputContribution>();
