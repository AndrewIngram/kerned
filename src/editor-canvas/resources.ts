import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm';

import { createOwnedEngine } from '../owned-layout';
import { readEditorAsset, type ResolveEditorAsset } from './assets';
import { createDOMFonts } from './dom-fonts';
import { createFontCatalog, type FontConfiguration } from './font-catalog';

type NativeResources = {
  kit: CanvasKit;
  fonts: Awaited<ReturnType<typeof createDOMFonts>>;
  layout: Awaited<ReturnType<typeof createOwnedEngine>>;
};

type ResourceState =
  | { status: 'loading' }
  | { status: 'ready'; resources: NativeResources }
  | { status: 'failed' }
  | { status: 'destroyed' };

function release(resources: NativeResources) {
  resources.fonts.destroy();
  resources.layout.destroy();
}

async function cancellable<T>(operation: Promise<T>, signal: AbortSignal) {
  let onAbort: (() => void) | undefined;

  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);

    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    return await Promise.race([operation, cancelled]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** Private view lifetime. Ordinary consumers mount a view, rather than borrowing these handles. */
export function createViewResources(
  options: {
    resolveAsset?: ResolveEditorAsset;
    fonts?: FontConfiguration;
    document?: Document;
  } = {},
) {
  const abort = new AbortController();
  const assets = { ...options, signal: abort.signal };
  let state: ResourceState = { status: 'loading' };
  let pending: AbortController | undefined;

  async function loadFonts(
    kit: CanvasKit,
    fonts: ReturnType<typeof createFontCatalog>,
    signal: AbortSignal,
  ): Promise<NativeResources> {
    const sources = { ...assets, signal };
    const data = await Promise.all(fonts.faces.map((face) => readEditorAsset(face.asset, sources)));
    const layout = await createOwnedEngine(kit, 'shaping', { ...sources, fonts, fontData: data });

    try {
      const browserFonts = await createDOMFonts(options.document ?? document, fonts, data, signal);

      if (signal.aborted) {
        browserFonts.destroy();
        signal.throwIfAborted();
      }

      return { kit, layout, fonts: browserFonts };
    } catch (error) {
      layout.destroy();
      throw error;
    }
  }

  async function initialize() {
    const fonts = createFontCatalog(options.fonts);
    const bytes = await readEditorAsset('engines/canvaskit.wasm', assets);

    if (!WebAssembly.validate(bytes)) throw new Error('Invalid graphics WebAssembly asset');
    abort.signal.throwIfAborted();
    // The shipped CanvasKit runtime supports locateFile, but ignores the
    // instantiateWasm option in its declarations. A revocable, preloaded URL
    // keeps network fetching under this owner's cancellation policy.
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
    let kit: CanvasKit;

    try {
      kit = await CanvasKitInit({ locateFile: () => url });
    } finally {
      URL.revokeObjectURL(url);
    }

    abort.signal.throwIfAborted();
    const resources = await loadFonts(kit, fonts, abort.signal);

    if (abort.signal.aborted) {
      release(resources);
      abort.signal.throwIfAborted();
    }

    state = { status: 'ready', resources };
  }

  async function load() {
    try {
      await cancellable(initialize(), abort.signal);
    } catch (error) {
      if (state.status !== 'destroyed') {
        state = { status: 'failed' };
        abort.abort(error);
      }

      throw error;
    }
  }

  const ready = load();

  // Destroy-before-await is a supported path; callers can still observe rejection.
  void ready.catch(() => {});

  return {
    ready,
    get status() {
      return state.status;
    },
    read() {
      if (state.status !== 'ready') throw new Error(`View resources are ${state.status}`);

      return state.resources;
    },
    /** Install synchronously while both collections are alive, then release the old one. */
    async replaceFonts(fonts: FontConfiguration, install: (next: NativeResources) => void) {
      const catalog = createFontCatalog(fonts);
      const request = new AbortController();
      pending?.abort(new DOMException('Font replacement was superseded', 'AbortError'));
      pending = request;
      const signal = AbortSignal.any([abort.signal, request.signal]);

      async function replace() {
        await ready;
        signal.throwIfAborted();

        if (state.status !== 'ready') throw new Error(`View resources are ${state.status}`);
        const previous = state.resources;
        const next = await loadFonts(previous.kit, catalog, signal);

        if (signal.aborted) {
          release(next);
          signal.throwIfAborted();
        }

        state = { status: 'ready', resources: next };

        try {
          install(next);
        } catch (error) {
          release(next);

          if (!abort.signal.aborted) state = { status: 'failed' };
          abort.abort(error);
          throw error;
        } finally {
          release(previous);
        }
      }

      try {
        await cancellable(replace(), signal);
      } finally {
        if (pending === request) pending = undefined;
      }
    },
    destroy() {
      if (state.status === 'destroyed') return;
      const previous = state;
      state = { status: 'destroyed' };
      abort.abort(new DOMException('Editor view was destroyed', 'AbortError'));

      if (previous.status === 'ready') {
        release(previous.resources);
      }
    },
  };
}
