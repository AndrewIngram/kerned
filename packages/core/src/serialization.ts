import {
  createDocumentSerializer,
  type NodeIdentity,
  type Schema,
  type SerializerContribution,
} from '@gprose/model';

import { defineContribution } from './contributions.js';

/** Optional, headless serializers supplied by the same extension assembly as the schema. */
export const serializers = defineContribution<SerializerContribution>();

export function createEditorSerializer<N extends NodeIdentity>(
  editor: { readonly schema: Schema<N>; readonly isDestroyed: boolean },
  options?: { unsupported?: 'reject' | 'text' },
) {
  return createDocumentSerializer(editor.schema, serializers.read(editor), options);
}
