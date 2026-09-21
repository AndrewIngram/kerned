import { validateInlineObjects } from './inline';
import {
  jsonRecord,
  jsonString,
  jsonNumber,
  jsonArray,
  jsonValue,
  type JsonValue,
} from './schema-codec';

export type InlineValue = Readonly<{ id: string; index: number; type: string; attrs: JsonValue }>;

type InlineValueProgram = {
  name: string;
  version: number;
  parse: (attrs: JsonValue) => JsonValue;
  validate: (attrs: JsonValue) => JsonValue;
  plainText: (attrs: JsonValue) => string;
};

export function createInlineValues(extensions: readonly InlineValueProgram[]) {
  const registry = new Map<string, InlineValueProgram>();

  for (const extension of extensions) {
    if (
      !extension.name ||
      registry.has(extension.name) ||
      !Number.isSafeInteger(extension.version) ||
      extension.version < 1
    )
      throw new Error('Invalid inline extension');
    registry.set(extension.name, extension);
  }

  function resolve(type: string) {
    const extension = registry.get(type);

    if (!extension) throw new Error(`Unknown inline type: ${type}`);

    return extension;
  }

  function make(
    type: string,
    id: string,
    index: number,
    attrs: JsonValue,
    mode: 'input' | 'canonical',
  ): InlineValue {
    if (!id || !Number.isSafeInteger(index) || index < 0)
      throw new Error('Invalid inline identity or offset');

    const extension = resolve(type);

    return {
      type,
      id,
      index,
      attrs: jsonValue(mode === 'input' ? extension.parse(attrs) : extension.validate(attrs)),
    };
  }

  return Object.freeze({
    create: (type: string, id: string, index: number, attrs: JsonValue) =>
      make(type, id, index, attrs, 'input'),
    plainText: (value: InlineValue) => resolve(value.type).plainText(value.attrs),
    encode(values: readonly InlineValue[]): JsonValue[] {
      return values.map((value) => ({
        ...make(value.type, value.id, value.index, value.attrs, 'canonical'),
        version: resolve(value.type).version,
      }));
    },
    decode(text: string, data: JsonValue): InlineValue[] {
      const values = jsonArray(data).map((raw) => {
        const value = jsonRecord(raw),
          type = jsonString(value.type);

        if (value.version !== resolve(type).version) throw new Error('Unsupported inline version');

        return make(type, jsonString(value.id), jsonNumber(value.index), value.attrs, 'canonical');
      });

      validateInlineObjects(text, values);

      return values;
    },
  });
}
