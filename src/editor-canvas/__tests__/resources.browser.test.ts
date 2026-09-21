import { expect, test } from 'vitest';

import type { EditorAsset } from '../assets';
import { defaultFonts } from '../font-catalog';
import { createViewResources } from '../resources';

test('resolves every asset, initializes native resources and disposes all layout handles', async () => {
  const requested: EditorAsset[] = [];

  const owner = createViewResources({
    resolveAsset(asset) {
      requested.push(asset);

      return new URL(`/${asset}`, location.href);
    },
  });

  expect(owner.status).toBe('loading');
  expect(() => owner.read()).toThrow(/loading/);

  try {
    await owner.ready;
    expect(owner.status).toBe('ready');
    expect(requested).toEqual([
      'engines/canvaskit.wasm',
      'engines/owned.wasm',
      ...defaultFonts.faces.map((face) => face.asset),
    ]);
    const { kit, layout } = owner.read();
    const paragraph = layout.layoutText({ text: 'Ready to edit', width: 200, size: 20, spans: [] });
    const surface = kit.MakeSurface(250, 100);

    if (!surface) throw new Error('Expected graphics surface');

    try {
      paragraph.draw(surface.getCanvas(), 0, 0);
      expect(paragraph.lines.length).toBeGreaterThan(0);
      expect(layout.memory().wasmLinearBytes).toBeGreaterThan(0);
      owner.destroy();
      owner.destroy();
      expect(owner.status).toBe('destroyed');
      expect(() => owner.read()).toThrow(/destroyed/);
      expect(layout.memory().wasmLinearBytes).toBe(0);
      expect(layout.retention().owners).toBe(0);
      expect(() => paragraph.draw(surface.getCanvas(), 0, 0)).toThrow(/destroyed/);
    } finally {
      surface.dispose();
    }
  } finally {
    owner.destroy();
  }
});

test('destruction before loading rejects readiness and cannot revive after queued work', async () => {
  const owner = createViewResources();
  owner.destroy();
  await expect(owner.ready).rejects.toMatchObject({ name: 'AbortError' });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(owner.status).toBe('destroyed');
  expect(() => owner.read()).toThrow(/destroyed/);
});

test('destruction during font resolution cancels native initialization', async () => {
  const requested: EditorAsset[] = [];

  const owner = createViewResources({
    resolveAsset(asset) {
      requested.push(asset);

      if (asset.startsWith('fonts/')) owner.destroy();

      return `/${asset}`;
    },
  });

  await expect(owner.ready).rejects.toMatchObject({ name: 'AbortError' });
  expect(requested).toEqual([
    'engines/canvaskit.wasm',
    'engines/owned.wasm',
    defaultFonts.faces[0].asset,
  ]);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(owner.status).toBe('destroyed');
  expect(() => owner.read()).toThrow(/destroyed/);
});

test('asset failure is observable and does not poison a fresh load', async () => {
  const failure = new Error('Asset resolver is unavailable');

  const failed = createViewResources({
    resolveAsset() {
      throw failure;
    },
  });

  await expect(failed.ready).rejects.toBe(failure);
  expect(failed.status).toBe('failed');
  expect(() => failed.read()).toThrow(/failed/);
  failed.destroy();
  const recovered = createViewResources();

  try {
    await recovered.ready;
    expect(recovered.status).toBe('ready');
    expect(
      recovered.read().layout.layoutText({ text: 'Recovered', width: 200, size: 20, spans: [] })
        .lines.length,
    ).toBeGreaterThan(0);
  } finally {
    recovered.destroy();
  }
});

test('font failures release the initialization path and retain their cause', async () => {
  const failure = new Error('Font source is unavailable');

  const owner = createViewResources({
    resolveAsset(asset) {
      if (asset.startsWith('fonts/')) throw failure;

      return `/${asset}`;
    },
  });

  await expect(owner.ready).rejects.toBe(failure);
  expect(owner.status).toBe('failed');
  expect(() => owner.read()).toThrow(/failed/);
  owner.destroy();
});

test('rejects corrupt graphics bytes before starting the native graphics loader', async () => {
  const owner = createViewResources({
    resolveAsset: () => 'data:application/wasm,not-a-wasm-file',
  });

  await expect(owner.ready).rejects.toThrow('Invalid graphics WebAssembly asset');
  expect(owner.status).toBe('failed');
  owner.destroy();
});

test('a corrupt later font fails after partial native setup without publishing resources', async () => {
  const owner = createViewResources({
    resolveAsset: (asset) =>
      asset === defaultFonts.faces[1].asset
        ? 'data:application/octet-stream,invalid-font'
        : `/${asset}`,
  });

  await expect(owner.ready).rejects.toThrow('Font registration failed');
  expect(owner.status).toBe('failed');
  expect(() => owner.read()).toThrow(/failed/);
  owner.destroy();
});

test('font configuration is captured before asynchronous asset loading', async ({
  onTestFinished,
}) => {
  const faces = defaultFonts.faces.map((entry) => ({ ...entry }));
  const owner = createViewResources({ fonts: { ...defaultFonts, faces } });
  onTestFinished(() => owner.destroy());
  faces[0].asset = 'fonts/missing-after-creation.ttf';
  faces[0].family = 'Changed while loading';
  await owner.ready;
  expect(owner.status).toBe('ready');

  const text = owner
    .read()
    .layout.layoutText({ text: 'Stable font snapshot', spans: [], size: 20, width: 200 });

  expect(text.lines.length).toBeGreaterThan(0);
});
