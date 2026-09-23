import { validateTextRange } from '@kerned/model';

import type { PresenceSelection } from '../protocol.js';
import type { Manifest } from './wire.js';

/** Text selections may span visible containers, but never opaque subtrees. */
export function readableSelection(
  selection: PresenceSelection | null,
  texts: ReadonlyMap<string, string>,
  manifest: readonly Manifest[],
): boolean {
  if (!selection) return true;
  const first = manifest.findIndex((item) => item.key === selection.anchor.key);
  const last = manifest.findIndex((item) => item.key === selection.head.key);

  if (
    first < 0 ||
    last < 0 ||
    manifest
      .slice(Math.min(first, last), Math.max(first, last) + 1)
      .some((item) => item.kind === 'protected')
  )
    return false;

  for (const point of [selection.anchor, selection.head]) {
    const text = texts.get(point.key);

    if (text === undefined) return false;

    try {
      validateTextRange(text, point.offset, point.offset);
    } catch {
      return false;
    }
  }

  return true;
}
