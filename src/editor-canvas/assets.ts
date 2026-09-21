/** Paths relative to the configured editor asset directory. */
export type EditorAsset = `engines/${string}.wasm` | `fonts/${string}`;

export type ResolveEditorAsset = (asset: EditorAsset) => string | URL;

export type EditorAssetOptions = {
  resolveAsset?: ResolveEditorAsset;
  signal?: AbortSignal;
};

export async function readEditorAsset(asset: EditorAsset, options: EditorAssetOptions) {
  options.signal?.throwIfAborted();
  const url = options.resolveAsset?.(asset) ?? `/${asset}`;
  const response = await fetch(url, { signal: options.signal });

  if (!response.ok) throw new Error(`Could not load editor asset "${asset}" (${response.status})`);

  return response.arrayBuffer();
}
