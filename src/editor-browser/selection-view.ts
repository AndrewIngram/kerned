import { type NodeIdentity, type Schema, wordRange } from '../model';
import { RangeSelection, TextSelection, type Selection, type SelectionContext } from '../state';

/** Resolve a selection against the renderer's ordered blocks. Containers can be
 * projected by an extension without teaching core about lists, tables or headings. */
export function selectionView<N extends NodeIdentity>(
  schema: Schema<N>,
  value: Selection,
  context: SelectionContext,
  indexes: ReadonlyMap<number, number>,
) {
  const ranges = value.ranges(context);
  const text = value instanceof TextSelection ? value : null;

  const focusId =
    value instanceof RangeSelection ? value.head.id : (text?.head.id ?? ranges[0]?.id ?? null);

  const anchorIndex = text ? indexes.get(text.anchor.id) : undefined;
  const headIndex = text ? indexes.get(text.head.id) : undefined;

  // Text endpoints inside an atomic projected container still use document order.
  const order =
    text && (anchorIndex === undefined || headIndex === undefined) ? context.order() : null;

  const a = order ? order.findIndex((node) => node.id === text?.anchor.id) : (anchorIndex ?? -1);
  const h = order ? order.findIndex((node) => node.id === text?.head.id) : (headIndex ?? -1);
  const forward = !text || a < h || (a === h && text.anchor.offset <= text.head.offset);
  const start = text ? (forward ? text.anchor : text.head) : null;
  const end = text ? (forward ? text.head : text.anchor) : null;
  const collapsed = value.isEmpty(context);
  const direct = new Map(ranges.map((range) => [range.id, range]));

  function selectedRange(node: N) {
    if (collapsed) return null;
    // An atomic renderer may contain text descendants (for example, a table).
    // A text range spanning that renderer selects the whole projected block.
    const index = indexes.get(node.id);

    if (
      text &&
      anchorIndex !== undefined &&
      headIndex !== undefined &&
      index !== undefined &&
      index > Math.min(anchorIndex, headIndex) &&
      index < Math.max(anchorIndex, headIndex) &&
      schema.text(node) === null
    )
      return { from: 0, to: 1 };
    const range = direct.get(node.id);

    if (range?.kind === 'text') return { from: range.from, to: range.to };
    let id: number | null = node.id;

    while (id !== null) {
      if (direct.get(id)?.kind === 'node') {
        return { from: 0, to: schema.text(node)?.length ?? 1 };
      }

      id = context.location(id)?.parent ?? null;
    }

    return null;
  }

  return {
    selection: value,
    textSelection: text,
    ranges,
    focusId,
    nonTextSelection: text === null,
    start,
    end,
    crossNode: text !== null && text.anchor.id !== text.head.id,
    collapsed,
    selectedRange,
  };
}

export function textSelectionAtClick(
  text: string,
  id: number,
  offset: number,
  upstream: boolean,
  clicks: number,
): TextSelection | null {
  if (clicks < 2) return null;

  const range =
    clicks >= 3 ? { from: 0, to: text.length } : wordRange(text, offset - (upstream ? 1 : 0));

  return new TextSelection({ id, offset: range.from }, { id, offset: range.to });
}
