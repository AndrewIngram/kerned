/** Paths relative to the configured editor asset directory. */
export type EditorAsset = `engines/${string}.wasm` | `fonts/${string}`;

export type ResolveEditorAsset = (asset: EditorAsset) => string | URL;

export type EditorAssetOptions = {
  resolveAsset?: ResolveEditorAsset;
  signal?: AbortSignal;
};

// Successful immutable asset bytes survive view replacement; native resources
// remain per-view. Bound retention so changing application URLs cannot grow it forever.
const cachedAssets = new Map<string, ArrayBuffer>();

let cachedBytes = 0;

const byteLimit = 64 * 1024 * 1024;

export async function readEditorAsset(asset: EditorAsset, options: EditorAssetOptions) {
  options.signal?.throwIfAborted();
  const url = options.resolveAsset?.(asset) ?? `/${asset}`;
  options.signal?.throwIfAborted();
  const key = new URL(url, globalThis.location?.href).href;
  const cached = cachedAssets.get(key);

  if (cached) {
    cachedAssets.delete(key);
    cachedAssets.set(key, cached);

    return cached;
  }

  const response = await fetch(url, { signal: options.signal });

  if (!response.ok) throw new Error(`Could not load editor asset "${asset}" (${response.status})`);

  const bytes = await response.arrayBuffer();
  options.signal?.throwIfAborted();
  const previous = cachedAssets.get(key);

  if (previous) return previous;

  if (bytes.byteLength <= byteLimit) {
    cachedAssets.set(key, bytes);
    cachedBytes += bytes.byteLength;

    while (cachedBytes > byteLimit || cachedAssets.size > 32) {
      const oldest = cachedAssets.entries().next();

      if (oldest.done) break;
      cachedAssets.delete(oldest.value[0]);
      cachedBytes -= oldest.value[1].byteLength;
    }
  }

  return bytes;
}
