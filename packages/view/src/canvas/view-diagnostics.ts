import { z } from 'zod';

import type { Line, Geometry } from '../internal/engines.js';
import type { Direction, Position } from '../internal/layout-types.js';

const optionsSchema = z.strictObject({
  composition: z.enum(['viewport', 'eager']).default('viewport'),
  retention: z.enum(['viewport', 'all']).default('viewport'),
});

export type DiagnosticOptions = z.input<typeof optionsSchema>;

export type DiagnosticPlacement = Readonly<{
  id: number;
  y: number;
  height: number;
  layoutWidth: number;
  resident: boolean;
  measured: Readonly<{ width: number; height: number }> | null;
  boxes: readonly Readonly<{
    id: string;
    index: number;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>[];
}>;

export type DiagnosticSnapshot = Readonly<{
  revision: number;
  generation: number;
  pending: number;
  blocks: number;
  width: number;
  height: number;
  paddingTop: number;
  cachedParagraphs: number;
  residentParagraphs: number;
  mounted: readonly number[];
  painterCount: number;
  stats: Readonly<{
    glyphCalls: number;
    cacheHits: number;
    paragraphs: number;
    lines: number;
    compositions: number;
    compositionHits: number;
    renderBuffers: number;
    validatedBlocks: number;
    validatedCharacters: number;
  }>;
  retention: Readonly<{ owners: number; documents: number; paragraphVariants: number }>;
  memory: Readonly<{
    caretBufferBytes: number;
    caretUsedBytes: number;
    caretUnusedBytes: number;
    caretCapacity: number;
    caretCount: number;
    lineCapacity: number;
    lineCount: number;
    glyphBufferBytes: number;
    shapingBufferBytes: number;
    wasmLinearBytes: number;
    paragraphs: number;
    composedParagraphs: number;
  }>;
}>;

type DiagnosticFrame = Readonly<{
  revision: number;
  generation: number;
  pending: number;
  blocks: number;
  width: number;
}>;

export type DiagnosticEvent = DiagnosticFrame &
  (
    | Readonly<{
        type: 'layout';
        at: number;
        duration: number;
        compositionMs: number;
        layoutIds: readonly number[];
        reflow: boolean;
        background: number;
      }>
    | Readonly<{
        type: 'paint';
        at: number;
        duration: number;
        submitted: number;
        mounted: number;
        stale: boolean;
      }>
  );

export type TextProbe = {
  id: number;
  range: { from: number; to: number; upstream?: boolean };
  hit?: { x: number; y: number };
  move?: { offset: number; upstream?: boolean; direction: Direction };
};

export type TextProbeResult = {
  height: number;
  lines: Line[];
  geometry: Geometry;
  hit: Position | null;
  move: Position | null;
};

export type ViewDiagnostics = {
  /** Copied resident text measurements for independent layout/interaction audits. */
  inspectText(this: void, probe: TextProbe): TextProbeResult | null;
  /** Fresh scalar counters, or null while detached/loading. Can scan retained buffers. */
  read(this: void): DiagnosticSnapshot | null;
  /** Copies placement metadata on demand. Omit IDs to inspect the whole document. */
  placements(this: void, ids?: readonly number[]): readonly DiagnosticPlacement[];
  /** Events are delivered after native work completes; unsubscribe cancels pending delivery. */
  subscribe(this: void, listener: (event: DiagnosticEvent) => void): () => void;
};

type Source = Pick<ViewDiagnostics, 'read' | 'placements' | 'inspectText'>;

type Binding = {
  source: Source;
};

type Owner = {
  options: z.output<typeof optionsSchema>;
  listeners: Set<(event: DiagnosticEvent) => void>;
  binding?: Binding;
};

const owners = new WeakMap<ViewDiagnostics, Owner>();

/** One diagnostics handle follows sequential mounts, never two simultaneous views. */
export function createViewDiagnostics(options: DiagnosticOptions = {}): ViewDiagnostics {
  const owner: Owner = { options: optionsSchema.parse(options), listeners: new Set() };

  const diagnostics: ViewDiagnostics = {
    read: () => owner.binding?.source.read() ?? null,
    inspectText: (probe) => owner.binding?.source.inspectText(probe) ?? null,
    placements: (ids) => owner.binding?.source.placements(ids) ?? [],
    subscribe(listener) {
      owner.listeners.add(listener);

      return () => {
        owner.listeners.delete(listener);
      };
    },
  };

  owners.set(diagnostics, owner);

  return diagnostics;
}

/** Internal lease. Consumers receive only copied data, never graphics/layout handles. */
export function connectViewDiagnostics(diagnostics: ViewDiagnostics, source: Source) {
  const owner = owners.get(diagnostics);

  if (!owner) throw new Error('Use createViewDiagnostics to create a diagnostics handle');

  if (owner.binding) throw new Error('Diagnostics already has a mounted view');
  const binding = { source };
  owner.binding = binding;

  return {
    options: owner.options,
    get observed() {
      return owner.binding === binding && owner.listeners.size > 0;
    },
    emit(event: DiagnosticEvent) {
      if (owner.binding !== binding || !owner.listeners.size) return;
      const observers = [...owner.listeners];
      queueMicrotask(() => {
        for (const listener of observers) {
          if (owner.binding !== binding) break;

          if (!owner.listeners.has(listener)) continue;

          try {
            listener(event);
          } catch (error) {
            queueMicrotask(() => {
              throw error;
            });
          }
        }
      });
    },
    destroy() {
      if (owner.binding === binding) owner.binding = undefined;
    },
  };
}
