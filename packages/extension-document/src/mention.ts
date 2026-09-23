import { createSchema, type InlineValue } from '@kerned/model';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import { mentionDefinition } from './definitions.js';

const inline = createSchema({ extensions: [mentionDefinition] }).inline;

export function mentionLayout(value: InlineValue) {
  return {
    id: value.id,
    index: value.index,
    ...mentionDefinition.spec.attributes.parse(value.attrs),
  };
}

export function mentionText(value: InlineValue) {
  return inline.plainText(value);
}

export function createMention({
  id,
  index,
  ...attrs
}: Pick<InlineValue, 'id' | 'index'> &
  StandardSchemaV1.InferInput<typeof mentionDefinition.spec.attributes>) {
  return inline.create('mention', id, index, attrs);
}
