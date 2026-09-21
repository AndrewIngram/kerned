import type { JsonValue } from './schema-codec';

export type Immutable<Value> = { readonly [Key in keyof Value]: Immutable<Value[Key]> };

/** Freeze an already validated JSON tree; callers own its cloned values. */
export function freezeJson<Value extends JsonValue>(value: Value): Immutable<Value>;
export function freezeJson(value: JsonValue): JsonValue {
  return freeze(value);
}

function freeze(value: JsonValue): JsonValue {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Recursive JSON traversal distinguishes scalar values from arrays and records.
  if (value === null || typeof value !== 'object') return value;

  for (const child of Object.values(value)) freeze(child);

  return Object.freeze(value);
}

function isArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/** Structural comparison without serializing attributes on the edit path. */
export function sameJson(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- JSON's scalar/object variants have no application discriminator.
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
    return false;

  if (isArray(left))
    return (
      isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]))
    );

  if (isArray(right)) return false;
  const keys = Object.keys(left);

  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]))
  );
}
