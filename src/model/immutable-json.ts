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
