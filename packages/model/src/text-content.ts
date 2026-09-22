import type { Schema } from './schema.js';

/** Project inline labels through the installed text behavior, regardless of field names. */
export function textContent<N>(schema: Schema<N>, node: N, from = 0, to?: number): string {
  const editing = schema.editing(node);
  const text = editing.text(node);
  const end = to ?? text.length;
  const inline = editing.inline;

  if (!inline) return text.slice(from, end);
  const values = inline.read(node);

  if (!values.length) return text.slice(from, end);
  let cursor = from;
  let result = '';

  for (const value of values.toSorted((a, b) => a.index - b.index)) {
    if (value.index < from || value.index >= end) continue;
    result += text.slice(cursor, value.index) + inline.plainText(value);
    cursor = value.index + 1;
  }

  return result + text.slice(cursor, end);
}
