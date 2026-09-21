import { defineContribution } from '../core';
import type { NodeIdentity } from '../model';
import type { ViewSession } from './input-contributions';

/** Non-schema styling of a UTF-16 text range. Attributes are limited to data-* metadata. */
export type TextDecoration = Readonly<{
  key: string;
  from: number;
  to: number;
  background: string;
  attributes?: Readonly<Record<`data-${string}`, string>>;
}>;

export type ReadTextDecorations = (id: number) => readonly TextDecoration[];

export type TextDecorationSource = {
  read: ReadTextDecorations;
  subscribe(this: void, listener: () => void): () => void;
};

export const nativeTextDecorations = defineContribution<{
  create<N extends NodeIdentity>(editor: ViewSession<N>): TextDecorationSource;
}>();

/** One native view reads only its resident text; sources never build a document-wide render map. */
export function createTextDecorations<N extends NodeIdentity>(
  editor: ViewSession<N>,
  invalidate: () => void,
) {
  const providers = nativeTextDecorations.read(editor);
  const sources: TextDecorationSource[] = [];
  let prepared = false;
  let destroyed = false;
  const cleanup: (() => void)[] = [];

  const cache = new Map<
    number,
    { inputs: readonly (readonly TextDecoration[])[]; value: readonly TextDecoration[] }
  >();

  const empty: readonly TextDecoration[] = [];
  const resident = new Set<number>();

  function release() {
    if (destroyed) return;
    destroyed = true;
    const errors: unknown[] = [];

    for (const stop of cleanup.splice(0).toReversed()) {
      try {
        stop();
      } catch (error) {
        errors.push(error);
      }
    }

    cache.clear();
    resident.clear();
    sources.length = 0;

    if (errors.length) throw new AggregateError(errors, 'Text decoration cleanup failed');
  }

  function prepare() {
    if (prepared) return;
    prepared = true;

    try {
      for (const provider of providers) {
        const source = provider.create(editor);
        sources.push(source);
        cleanup.push(source.subscribe(() => invalidate()));
      }
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
      prepare();

      if (!sources.length) return empty;

      if (sources.length === 1) return sources[0].read(id);
      resident.add(id);
      const inputs = sources.map((source) => source.read(id));
      const cached = cache.get(id);

      if (cached && inputs.every((value, i) => value === cached.inputs[i])) return cached.value;
      const value = inputs.flat();
      cache.set(id, { inputs, value });

      return value;
    },
    begin() {
      resident.clear();
    },
    end() {
      for (const id of cache.keys()) if (!resident.has(id)) cache.delete(id);
    },
    destroy: release,
  };
}
