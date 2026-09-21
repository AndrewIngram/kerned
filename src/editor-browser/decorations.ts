import { defineContribution } from '../core';
import type { NodeIdentity } from '../model';
import type { EditorState } from '../state';
import type { ViewSession } from './input-contributions';

export type DecorationActivation = Readonly<{
  nodeId: number;
  key: string;
  offset: number;
  kind: 'text' | 'control';
}>;

type Metadata = Readonly<Record<`data-${string}`, string>>;

type Activation = Readonly<{
  label: string;
  attributes?: Metadata;
  onActivate: (event: DecorationActivation) => void;
}>;

/** View-only values. Keys identify instances within a source/node, not document anchors. */
export type TextDecoration = Readonly<{
  kind: 'text';
  key: string;
  from: number;
  to: number;
  background: string;
  attributes?: Metadata;
  activation?: Activation;
}>;

export type NodeDecoration = Readonly<{
  kind: 'node';
  key: string;
  outline: Readonly<{ color: string; width: number; radius: number }>;
  attributes?: Metadata;
  activation?: Pick<Activation, 'onActivate'>;
}>;

export type Decoration = TextDecoration | NodeDecoration;

/** Omit IDs for global invalidation; supplied IDs replace only those node results. */
export type InvalidateDecorations = (ids?: readonly number[]) => void;

export type DecorationSource<N extends NodeIdentity> = {
  read(id: number, state: EditorState<N>): readonly Decoration[];
  subscribe(this: void, listener: InvalidateDecorations): () => void;
  destroy?(): void;
};

export type DecorationContribution = {
  readonly name: string;
  /** Node-local sources may depend on that node and explicitly invalidated external data only. */
  readonly dependencies?: 'node' | 'document';
  create<N extends NodeIdentity>(editor: ViewSession<N>): DecorationSource<N>;
};

export const decorations = defineContribution<DecorationContribution>();

export function decorationContributions(editor: Parameters<typeof decorations.read>[0]) {
  const values = decorations.read(editor);
  const names = new Set<string>();

  for (const value of values) {
    if (!value.name || names.has(value.name))
      throw new Error(`Duplicate or empty decoration source: ${value.name}`);
    names.add(value.name);
  }

  return values;
}

/** Cache only resident results and invalidate according to each source's declared dependencies. */
export function createDecorationSource<N extends NodeIdentity>(
  provider: DecorationContribution,
  editor: ViewSession<N>,
  invalidate: () => void,
) {
  const source = provider.create(editor);
  const resident = new Set<number>();

  const cache = new Map<
    number,
    { node: NodeIdentity; version: number; values: readonly Decoration[] }
  >();

  let currentState: EditorState<N> | undefined;
  let version = 0;
  let destroyed = false;
  let unsubscribe: (() => void) | undefined;

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cache.clear();
    resident.clear();
    currentState = undefined;
    const failures: unknown[] = [];

    try {
      unsubscribe?.();
    } catch (error) {
      failures.push(error);
    }

    try {
      source.destroy?.();
    } catch (error) {
      failures.push(error);
    }

    if (failures.length) throw new AggregateError(failures, 'Decoration source cleanup failed');
  }

  try {
    unsubscribe = source.subscribe((ids) => {
      if (destroyed) return;

      if (ids) for (const id of ids) cache.delete(id);
      else cache.clear();

      if (!ids || ids.some((id) => resident.has(id))) invalidate();
    });
  } catch (error) {
    try {
      destroy();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'Decoration source setup failed', {
        cause: cleanup,
      });
    }

    throw error;
  }

  return {
    begin() {
      resident.clear();
    },
    read(node: NodeIdentity, state: EditorState<N>) {
      if (destroyed) throw new Error('Decoration source is destroyed');
      resident.add(node.id);

      if (currentState !== state) {
        currentState = state;
        version++;
      }

      const previous = cache.get(node.id);

      if (
        previous &&
        previous.node === node &&
        (provider.dependencies === 'node' || previous.version === version)
      )
        return previous.values;
      const values = source.read(node.id, state);
      const keys = new Set<string>();

      for (const value of values) {
        if (!value.key || keys.has(value.key))
          throw new Error(
            `Duplicate or empty decoration key in ${provider.name} for node ${node.id}: ${value.key}`,
          );
        keys.add(value.key);
      }

      cache.set(node.id, { node, version, values });

      return values;
    },
    end() {
      for (const id of cache.keys()) if (!resident.has(id)) cache.delete(id);

      if (!resident.size) currentState = undefined;
    },
    destroy,
  };
}
