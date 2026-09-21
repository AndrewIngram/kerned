import type { InlineValue } from '../model';
import type { InlineAtom } from '../owned-inline';
import { demoSchema } from './demo-schema';
import { mentionDefinition } from './starter-definitions';

export const inlineSchema = {
  ...demoSchema.inline,
  layout(this: void, value: InlineValue): InlineAtom {
    return {
      id: value.id,
      index: value.index,
      ...mentionDefinition.spec.attributes.parse(value.attrs),
    };
  },
};

export function createMention({ id, index, ...attrs }: InlineAtom) {
  return inlineSchema.create('mention', id, index, attrs);
}
