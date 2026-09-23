import {
  removeMark,
  setMark,
  type Mark,
  type NodeIdentity,
  type Schema,
  boundaries,
} from '@kerned/model';

export function markInsertedText<N extends NodeIdentity>(
  schema: Schema<N>,
  node: N,
  from: number,
  length: number,
  marks: readonly Mark[],
): N {
  if (!length) return node;
  const extension = schema.resolve(node);

  if (extension.kind !== 'text' || !extension.editing.marks) {
    if (marks.length) throw new Error('Text does not support marks');

    return node;
  }

  const adapter = extension.editing.marks,
    stops = boundaries(extension.editing.text(node));

  const start = [...stops].toReversed().find((offset) => offset <= from) ?? 0,
    end = stops.find((offset) => offset >= from + length) ?? from + length;

  let ranges = removeMark(adapter.read(node), start, end);

  for (const mark of marks) ranges = setMark(ranges, start, end, mark);

  return adapter.write(node, ranges);
}
