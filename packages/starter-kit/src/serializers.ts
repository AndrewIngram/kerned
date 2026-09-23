import { defineExtension, serializers, type ContributionContext } from '@kerned/core';
import { documentSerializers } from '@kerned/extension-document';
import { tableSerializers } from '@kerned/extension-table';

export const starterSerializers = [...documentSerializers, ...tableSerializers] as const;

export const starterSerialization = defineExtension({
  name: 'starterSerialization',
  options: {},
  setup(_options, context: ContributionContext) {
    for (const serializer of starterSerializers) context.provide(serializers, serializer);

    return {};
  },
});
