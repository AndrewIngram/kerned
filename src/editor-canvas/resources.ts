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
    const data = await Promise.all(fonts.faces.map((face) => readEditorAsset(face.asset, assets)));
    const layout = await createOwnedEngine(kit, 'shaping', { ...assets, fonts, fontData: data });

    try {
      const browserFonts = await createDOMFonts(
        options.document ?? document,
        fonts,
        data,
        abort.signal,
      );

      if (abort.signal.aborted) {
        browserFonts.destroy();
        abort.signal.throwIfAborted();
      }

      state = { status: 'ready', resources: { kit, layout, fonts: browserFonts } };
    } catch (error) {
      layout.destroy();
      throw error;
    }
  }

  let onAbort: (() => void) | undefined;

  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(abort.signal.reason);
    abort.signal.addEventListener('abort', onAbort, { once: true });
  });

  async function load() {
    try {
      await Promise.race([initialize(), cancelled]);
    } catch (error) {
      if (state.status !== 'destroyed') {
        state = { status: 'failed' };
        abort.abort(error);
      }

      throw error;
    } finally {
      if (onAbort) abort.signal.removeEventListener('abort', onAbort);
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
    destroy() {
      if (state.status === 'destroyed') return;
      const previous = state;
      state = { status: 'destroyed' };
      abort.abort(new DOMException('Editor view was destroyed', 'AbortError'));

      if (previous.status === 'ready') {
        previous.resources.fonts.destroy();
        previous.resources.layout.destroy();
      }
    },
  };
}
