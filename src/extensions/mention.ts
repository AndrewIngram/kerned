import type { InlineValue } from '@gprose/model';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import { demoSchema } from './demo-schema';
import { mentionDefinition } from './starter-definitions';

export const inlineSchema = {
  ...demoSchema.inline,
  layout(this: void, value: InlineValue) {
    return {
      id: value.id,
      index: value.index,
      ...mentionDefinition.spec.attributes.parse(value.attrs),
    };
  },
};

export function createMention({
  id,
  index,
  ...attrs
}: Pick<InlineValue, 'id' | 'index'> &
  StandardSchemaV1.InferInput<typeof mentionDefinition.spec.attributes>) {
  return inlineSchema.create('mention', id, index, attrs);
}
