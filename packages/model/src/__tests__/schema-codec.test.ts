import { expect, test } from 'vitest';
import { z } from 'zod';

import { jsonRecord, jsonValue, type JsonValue } from '../schema-codec.js';

test('JSON codecs copy nested values and preserve special keys without prototype pollution', () => {
  const source = {
    ['__proto__']: { safe: true },
    constructor: 'value',
    items: [{ value: 1 }],
  };

  const copied = jsonRecord(source);
  expect(copied).toEqual(source);
  source.items[0].value = 2;
  expect(copied.items).toEqual([{ value: 1 }]);
  expect(Object.hasOwn(copied, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(copied)).toBe(Object.prototype);
  expect(jsonRecord(Object.assign(Object.create(null), { value: 1 }))).toEqual({ value: 1 });
});

test.each([
  { label: 'undefined', value: undefined },
  { label: 'NaN', value: NaN },
  { label: 'Infinity', value: Infinity },
  { label: '1n', value: 1n },
  { label: 'Symbol(value)', value: Symbol('value') },
  { label: '() => 1', value: () => 1 },
  { label: 'Date', value: new Date() },
  {
    label: 'Value { value: 1 }',
    value: new (class Value {
      value = 1;
    })(),
  },
  { label: '{ value: undefined }', value: { value: undefined } },
])('rejects non-JSON value $label', (entry) => {
  expect(() => jsonValue(entry.value)).toThrow(z.ZodError);
});

test('rejects cyclic objects and arrays', () => {
  const object: Record<string, JsonValue> = {};
  object.self = object;
  const array: JsonValue[] = [];
  array.push(array);
  expect(() => jsonValue(object)).toThrow(z.ZodError);
  expect(() => jsonValue(array)).toThrow(z.ZodError);
});

test('accepts JSON at the nesting limit and rejects one level beyond it', () => {
  let value: JsonValue = null;

  for (let depth = 0; depth < 256; depth++) value = [value];
  expect(jsonValue(value)).toEqual(value);
  expect(() => jsonValue([value])).toThrow(z.ZodError);
});
