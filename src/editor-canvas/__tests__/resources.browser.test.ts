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
  expect(requested).toEqual([
    'engines/canvaskit.wasm',
    ...defaultFonts.faces.map((face) => face.asset),
  ]);

  try {
    await owner.ready;
    expect(owner.status).toBe('ready');
    expect(requested).toEqual([
      'engines/canvaskit.wasm',
      ...defaultFonts.faces.map((face) => face.asset),
      'engines/owned.wasm',
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

test('destruction while parallel fonts load cancels native initialization', async () => {
  const requested: EditorAsset[] = [];

  const owner = createViewResources({
    resolveAsset(asset) {
      requested.push(asset);

      if (asset === defaultFonts.faces[0].asset) queueMicrotask(() => owner.destroy());

      return `/${asset}`;
    },
  });

  await expect(owner.ready).rejects.toMatchObject({ name: 'AbortError' });
  expect(requested).toEqual([
    'engines/canvaskit.wasm',
    ...defaultFonts.faces.map((face) => face.asset),
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

test('browser fonts match each view catalog and releasing one leaves the other registered', async ({
  onTestFinished,
}) => {
  const regular = createViewResources();

  const bold = createViewResources({
    fonts: {
      ...defaultFonts,
      faces: defaultFonts.faces.map((face, index) =>
        index === 0 ? { ...face, asset: defaultFonts.faces[1].asset } : face,
      ),
    },
  });

  const a = document.createElement('span');
  const b = document.createElement('span');
  onTestFinished(() => {
    regular.destroy();
    bold.destroy();
    a.remove();
    b.remove();
  });
  await Promise.all([regular.ready, bold.ready]);
  const ordinary = regular.read().fonts.resolve();
  const display = bold.read().fonts.resolve();
  expect(ordinary.cssFamily).not.toBe(display.cssFamily);

  for (const [element, fonts] of [
    [a, ordinary],
    [b, display],
  ] as const) {
    element.textContent = 'MMMMMMMM';
    element.style.cssText = `position:absolute;font:400 24px ${fonts.cssFamily};font-synthesis:none;white-space:pre;`;
    document.body.append(element);
  }

  const widthA = a.getBoundingClientRect().width;
  const widthB = b.getBoundingClientRect().width;
  expect(widthA).not.toBe(widthB);
  const input = { text: 'MMMMMMMM', width: 1000, size: 24, spans: [] };
  expect(widthA).toBeCloseTo(regular.read().layout.layoutText(input).lines[0].width, 0);
  expect(widthB).toBeCloseTo(bold.read().layout.layoutText(input).lines[0].width, 0);

  const registered = [...document.fonts].filter((face) =>
    display.cssFamily.startsWith(`"${face.family}"`),
  );

  expect(registered).toHaveLength(1);
  expect(registered.every((face) => face.status === 'loaded')).toBe(true);
  regular.destroy();
  expect(registered.every((face) => document.fonts.has(face))).toBe(true);
  expect(b.getBoundingClientRect().width).toBe(widthB);
  bold.destroy();
  expect(registered.every((face) => !document.fonts.has(face))).toBe(true);
});

test('font replacement reuses graphics, swaps atomically and releases the old collection', async ({
  onTestFinished,
}) => {
  const owner = createViewResources();
  onTestFinished(() => owner.destroy());
  await owner.ready;
  const previous = owner.read();
  const input = { text: 'MMMMMMMM', width: 1000, size: 24, spans: [] };
  const before = previous.layout.layoutText(input).lines[0].width;

  const faces = defaultFonts.faces.map((face, index) =>
    index === 0 ? { ...face, asset: defaultFonts.faces[1].asset } : { ...face },
  );

  let installs = 0;

  const replacement = owner.replaceFonts({ ...defaultFonts, faces }, (next) => {
    installs++;
    expect(owner.read()).toBe(next);
    expect(next.kit).toBe(previous.kit);
    expect(next.layout.layoutText(input).lines[0].width).not.toBe(before);
    expect(previous.layout.memory().wasmLinearBytes).toBeGreaterThan(0);
    expect(previous.fonts.resolve().cssFamily).not.toBe(next.fonts.resolve().cssFamily);
  });

  faces[0].asset = 'fonts/not-loaded.ttf';
  expect(owner.read()).toBe(previous);
  await replacement;
  expect(installs).toBe(1);
  expect(previous.layout.memory().wasmLinearBytes).toBe(0);
  expect(() => previous.fonts.resolve()).toThrow(/destroyed/);
  expect(owner.status).toBe('ready');
});

test('failed replacement preserves current fonts and permits retry', async ({ onTestFinished }) => {
  const owner = createViewResources({
    resolveAsset: (asset) =>
      asset === 'fonts/broken.ttf' ? 'data:application/octet-stream,invalid-font' : `/${asset}`,
  });

  onTestFinished(() => owner.destroy());
  await owner.ready;
  const previous = owner.read();

  const fonts = {
    ...defaultFonts,
    faces: defaultFonts.faces.map((face, index) =>
      index === 1 ? { ...face, asset: 'fonts/broken.ttf' as const } : face,
    ),
  };

  await expect(
    owner.replaceFonts(fonts, () => {
      throw new Error('Failed fonts must not install');
    }),
  ).rejects.toThrow('Font registration failed');
  expect(owner.read()).toBe(previous);
  expect(previous.layout.memory().wasmLinearBytes).toBeGreaterThan(0);
  await owner.replaceFonts(defaultFonts, () => {});
  expect(owner.read()).not.toBe(previous);
});

test('superseded font requests and destruction cannot install late resources', async ({
  onTestFinished,
}) => {
  const owner = createViewResources();
  onTestFinished(() => owner.destroy());
  await owner.ready;
  const previous = owner.read();
  let installs = 0;

  const first = owner.replaceFonts(defaultFonts, () => {
    installs++;
  });

  const second = owner.replaceFonts(defaultFonts, () => {
    installs++;
  });

  await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await second;
  expect(installs).toBe(1);
  expect(previous.layout.memory().wasmLinearBytes).toBe(0);

  const pending = owner.replaceFonts(defaultFonts, () => {
    installs++;
  });

  owner.destroy();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(installs).toBe(1);
  expect(owner.status).toBe('destroyed');
});
