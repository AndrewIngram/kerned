import { defineExtension, serializers, type ContributionContext } from '@gprose/core';
import { documentSerializers } from '@gprose/extension-document';
import { tableSerializers } from '@gprose/extension-table';

export const starterSerializers = [...documentSerializers, ...tableSerializers] as const;

export const starterSerialization = defineExtension({
  name: 'starterSerialization',
  options: {},
  setup(_options, context: ContributionContext) {
    for (const serializer of starterSerializers) context.provide(serializers, serializer);

    return {};
  },
});
