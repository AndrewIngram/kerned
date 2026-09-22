import type { NodeIdentity } from '@gprose/model';
import type { SelectionContext } from '@gprose/state';

import {
  createDecorationSource,
  decorationContributions,
  type Decoration,
  type TextDecoration,
} from './decorations';
import type { ViewSession } from './input-contributions';

export type { TextDecoration } from './decorations';

export type ReadTextDecorations = (id: number) => readonly TextDecoration[];

/** Native text borrows the same public source contract as canvas decoration layers. */
export function createTextDecorations<N extends NodeIdentity>(
  editor: ViewSession<N>,
  invalidate: () => void,
) {
  const providers = decorationContributions(editor);
  const sources: ReturnType<typeof createDecorationSource<N>>[] = [];
  let prepared = false;
  let destroyed = false;
  let context: SelectionContext | undefined;

  const cache = new Map<
    number,
    { inputs: readonly (readonly Decoration[])[]; value: readonly TextDecoration[] }
  >();

  const empty: readonly TextDecoration[] = [];
  const resident = new Set<number>();

  function release() {
    if (destroyed) return;
    destroyed = true;
    const errors: unknown[] = [];

    for (const source of sources.splice(0).toReversed()) {
      try {
        source.destroy();
      } catch (error) {
        errors.push(error);
      }
    }

    cache.clear();
    resident.clear();
    context = undefined;

    if (errors.length) throw new AggregateError(errors, 'Text decoration cleanup failed');
  }

  function prepare() {
    if (prepared) return;
    prepared = true;

    try {
      for (const provider of providers)
        sources.push(createDecorationSource(provider, editor, invalidate));
    } catch (error) {
      try {
        release();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Text decoration setup failed', {
          cause: cleanupError,
        });
      }

      throw error;
    }
  }

  return {
    read(this: void, id: number): readonly TextDecoration[] {
      if (destroyed) throw new Error('Text decoration view is destroyed');
      const node = context?.node(id);

      if (!node || !providers.length) return empty;
      prepare();
      resident.add(id);
      const inputs = sources.map((source) => source.read(node, editor.state));
      const previous = cache.get(id);

      if (previous && inputs.every((value, i) => value === previous.inputs[i]))
        return previous.value;

      const value = inputs.flatMap((values, index) =>
        values.flatMap((decoration) =>
          decoration.kind === 'text'
            ? [{ ...decoration, key: JSON.stringify([providers[index].name, decoration.key]) }]
            : [],
        ),
      );

      cache.set(id, { inputs, value });

      return value;
    },
    begin(next: SelectionContext) {
      context = next;
      resident.clear();

      for (const source of sources) source.begin();
    },
    end() {
      for (const source of sources) source.end();

      for (const id of cache.keys()) if (!resident.has(id)) cache.delete(id);
    },
    destroy: release,
  };
}
