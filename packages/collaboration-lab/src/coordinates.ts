import {
  boundaries,
  indexTree,
  validateTextRange,
  type NodeIdentity,
  type Schema,
} from '@kerned/model';
import type { Step } from '@kerned/transform';

import type { Edit, Endpoint, PresenceSelection } from './protocol.js';

/** Schema-aware validation after numeric mapping: edits must remain exact,
 * while presence may snap to a surviving grapheme according to association. */
export function documentCoordinates<N extends NodeIdentity>(
  schema: Schema<N>,
  nodes: readonly N[],
) {
  const tree = indexTree(schema, nodes);

  return {
    edit(value: Edit): Step<N> | null {
      const node = tree.byKey.get(value.key)?.node;
      const text = node && schema.text(node);

      if (
        !node ||
        text === undefined ||
        text === null ||
        text.slice(value.from, value.to) !== value.expected
      )
        return null;

      try {
        validateTextRange(text, value.from, value.to);
      } catch {
        return null;
      }

      return { kind: 'replaceText', id: node.id, from: value.from, to: value.to, text: value.text };
    },
    normalizeSelection(value: PresenceSelection | null): PresenceSelection | null {
      if (!value) return null;

      function normalize(point: Endpoint): Endpoint | null {
        const node = tree.byKey.get(point.key)?.node;
        const text = node && schema.text(node);

        if (text === undefined || text === null || point.offset < 0 || point.offset > text.length)
          return null;
        const stops = boundaries(text);

        const offset =
          point.association === 1
            ? stops.find((at) => at >= point.offset)
            : stops.findLast((at) => at <= point.offset);

        return offset === undefined ? null : { ...point, offset };
      }

      const anchor = normalize(value.anchor),
        head = normalize(value.head);

      return anchor && head ? { anchor, head } : null;
    },
  };
}
