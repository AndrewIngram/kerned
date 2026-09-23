import { createEditor, defineExtension, type ContributionContext } from '@kerned/core';
import { createSchema, defineNode } from '@kerned/model';
import {
  defaultFonts,
  defaultAccessibility,
  defineNodePresentation,
  defineStyleRule,
  presentations,
  type MountedEditor,
} from '@kerned/view';
import { createViewDiagnostics } from '@kerned/view/diagnostics';
import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { EditorContent } from '../editor-content.js';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ body: z.string() }),
    content: { kind: 'text', field: 'body' },
  }),
});

const view = defineExtension({
  name: 'view',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(
      presentations,
      defineNodePresentation(note, () => (attrs) => ({
        kind: 'text',
        text: attrs.body,
        size: 18,
        lineHeight: 28,
        before: 0,
        after: 16,
        baselineGrid: 4,
        spans: [],
        atoms: [],
      })),
    );

    return {};
  },
});

const size = { width: 400, height: 260 };

const initialTheme = { rules: [defineStyleRule(note, { lineHeight: 40 })] };

const nextTheme = { rules: [defineStyleRule(note, { lineHeight: 48 })] };

const replacementFonts = {
  ...defaultFonts,
  faces: defaultFonts.faces.map((face, index) =>
    index === 0 ? { ...face, asset: defaultFonts.faces[1].asset } : face,
  ),
};

const invalidAsset = () => 'data:application/wasm,invalid';

function unexpectedRemount() {
  throw new Error('Unexpected remount');
}

const schema = createSchema({ extensions: [note, view] });

function fixture() {
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);

  const editor = createEditor({
    schema,
    content: [{ kind: 'note', body: 'React owns only attachment' }],
  });

  let mounted: MountedEditor | undefined;
  const failures: Error[] = [];
  let complete: ((value: MountedEditor) => void) | undefined;
  let failed: ((value: Error) => void) | undefined;

  const readiness = new Promise<MountedEditor>((resolve) => {
    complete = resolve;
  });

  const failure = new Promise<Error>((resolve) => {
    failed = resolve;
  });

  return {
    get mounted() {
      return mounted;
    },
    failures,
    readiness,
    failure,
    ready(this: void, value: MountedEditor) {
      mounted = value;
      complete?.(value);
    },
    failed(this: void, error: Error) {
      failures.push(error);
      failed?.(error);
    },
    element,
    root,
    editor,
    destroy() {
      flushSync(() => root.unmount());
      editor.destroy();
      element.remove();
    },
  };
}

test('React strict lifetime uses the vanilla mount and detaches without destroying its borrowed session', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const diagnostics = createViewDiagnostics();

  flushSync(() =>
    f.root.render(
      <StrictMode>
        <EditorContent editor={f.editor} style={size} onReady={f.ready} diagnostics={diagnostics} />
      </StrictMode>,
    ),
  );
  await f.readiness;
  expect(f.mounted?.status).toBe('ready');
  expect(diagnostics.read()?.blocks).toBe(1);
  expect(f.element.querySelectorAll('canvas')).toHaveLength(1);
  f.editor.commands.focus();
  expect(document.activeElement).toBe(f.element.querySelector('textarea'));
  const first = f.mounted;
  // A callback-only rerender must preserve the mounted editor and native allocations.
  flushSync(() =>
    f.root.render(
      <StrictMode>
        <EditorContent
          editor={f.editor}
          style={size}
          onReady={unexpectedRemount}
          diagnostics={diagnostics}
        />
      </StrictMode>,
    ),
  );
  expect(f.mounted).toBe(first);
  flushSync(() => f.root.render(null));
  expect(first?.status).toBe('destroyed');
  expect(f.editor.isDestroyed).toBe(false);
  expect(f.element.querySelector('canvas')).toBeNull();
  expect(diagnostics.read()).toBeNull();
});

test('React reports asset failure and can retry without replacing the session', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());

  flushSync(() =>
    f.root.render(
      <EditorContent editor={f.editor} resolveAsset={invalidAsset} onError={f.failed} />,
    ),
  );
  await f.failure;
  expect(f.failures).toHaveLength(1);
  await expect
    .poll(() => f.element.querySelector('[role="alert"]')?.textContent)
    .toMatch(/Invalid graphics/);
  flushSync(() =>
    f.root.render(<EditorContent editor={f.editor} style={size} onReady={f.ready} />),
  );
  await f.readiness;
  expect(f.mounted?.status).toBe('ready');
  await expect.poll(() => f.element.querySelector('[role="alert"]')).toBeNull();
});

test('React updates zoom and padding without replacing its view, including props changed while loading', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  flushSync(() =>
    f.root.render(
      <EditorContent
        editor={f.editor}
        style={size}
        onReady={f.ready}
        zoom={1.25}
        paddingTop={16}
      />,
    ),
  );
  flushSync(() =>
    f.root.render(
      <EditorContent editor={f.editor} style={size} onReady={f.ready} zoom={1.5} paddingTop={32} />,
    ),
  );
  const mounted = await f.readiness;
  expect(mounted.getSnapshot()?.zoom).toBe(1.5);
  const canvas = f.element.querySelector('canvas');
  const before = mounted.blockBounds(f.editor.state.nodes[0].id);

  if (!before) throw new Error('Expected initial block bounds');
  mounted.focus();
  const input = f.element.querySelector('textarea');
  flushSync(() =>
    f.root.render(
      <EditorContent
        editor={f.editor}
        style={size}
        onReady={unexpectedRemount}
        zoom={2}
        paddingTop={64}
      />,
    ),
  );
  expect(mounted.getSnapshot()?.zoom).toBe(2);
  expect(mounted.blockBounds(before.id)?.top).toBeCloseTo(before.top + 32);
  expect(document.activeElement).toBe(input);
  expect(f.element.querySelector('canvas')).toBe(canvas);
  flushSync(() =>
    f.root.render(<EditorContent editor={f.editor} style={size} onReady={unexpectedRemount} />),
  );
  expect(mounted.getSnapshot()?.zoom).toBe(1);
  expect(mounted.blockBounds(before.id)?.top).toBeCloseTo(before.top - 32);
  expect(f.element.querySelector('[zoom], [paddingtop]')).toBeNull();
});

test('React remounts on session replacement and tolerates updates after borrowed session destruction', async ({
  onTestFinished,
}) => {
  const first = fixture();
  const second = fixture();
  onTestFinished(() => {
    first.destroy();
    second.destroy();
  });
  flushSync(() =>
    first.root.render(<EditorContent editor={first.editor} style={size} onReady={first.ready} />),
  );
  const original = await first.readiness;
  original.focus();
  const oldInput = first.element.querySelector('textarea');
  oldInput?.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  flushSync(() =>
    first.root.render(<EditorContent editor={second.editor} style={size} onReady={second.ready} />),
  );
  const replacement = await second.readiness;
  expect(original.isDestroyed).toBe(true);
  expect(first.editor.isDestroyed).toBe(false);
  replacement.focus();
  const input = first.element.querySelector('textarea');
  expect(input).not.toBe(oldInput);
  expect(document.activeElement).toBe(input);
  first.editor.commands.focus();
  expect(document.activeElement).toBe(input);
  second.editor.destroy();
  expect(replacement.isDestroyed).toBe(true);
  flushSync(() =>
    first.root.render(
      <EditorContent editor={second.editor} style={size} zoom={1.25} paddingTop={24} />,
    ),
  );
  expect(first.element.querySelector('canvas')).toBeNull();
  expect(() => second.editor.commands.focus()).toThrow(/destroyed/);
  flushSync(() =>
    first.root.render(<EditorContent key="closed" editor={second.editor} style={size} />),
  );
  expect(first.element.querySelector('canvas')).toBeNull();
});

test('React applies and removes a theme without remounting or leaking it into DOM attributes', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  flushSync(() =>
    f.root.render(
      <EditorContent editor={f.editor} style={size} onReady={f.ready} theme={initialTheme} />,
    ),
  );
  const mounted = await f.readiness;
  const point = { id: f.editor.state.nodes[0].id, offset: 0 };
  expect(mounted.coordsAt(point)?.height).toBe(40);
  const canvas = f.element.querySelector('canvas');
  mounted.focus();
  const input = f.element.querySelector('textarea');
  const selection = f.editor.state.selection;
  flushSync(() =>
    f.root.render(
      <EditorContent
        editor={f.editor}
        style={size}
        onReady={unexpectedRemount}
        theme={nextTheme}
      />,
    ),
  );
  expect(mounted.coordsAt(point)?.height).toBe(48);
  flushSync(() =>
    f.root.render(<EditorContent editor={f.editor} style={size} onReady={unexpectedRemount} />),
  );
  expect(mounted.coordsAt(point)?.height).toBe(28);
  expect(f.element.querySelector('canvas')).toBe(canvas);
  expect(document.activeElement).toBe(input);
  expect(f.editor.state.selection).toBe(selection);
  expect(f.element.querySelector('[theme]')).toBeNull();
});

test('React font props replace live resources without remounting and restore defaults', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  flushSync(() =>
    f.root.render(<EditorContent editor={f.editor} style={size} onReady={f.ready} />),
  );
  const mounted = await f.readiness;
  const id = f.editor.state.nodes[0].id;
  const caret = mounted.coordsAt({ id, offset: 5 });
  const canvas = f.element.querySelector('canvas');

  flushSync(() =>
    f.root.render(
      <EditorContent
        editor={f.editor}
        fonts={replacementFonts}
        style={size}
        onReady={unexpectedRemount}
      />,
    ),
  );
  await expect.poll(() => mounted.coordsAt({ id, offset: 5 })?.left).not.toBe(caret?.left);
  expect(f.element.querySelector('canvas')).toBe(canvas);
  expect(mounted.status).toBe('ready');
  flushSync(() =>
    f.root.render(<EditorContent editor={f.editor} style={size} onReady={unexpectedRemount} />),
  );
  await expect.poll(() => mounted.coordsAt({ id, offset: 5 })?.left).toBe(caret?.left);
  expect(f.element.querySelector('canvas')).toBe(canvas);
  expect(f.element.querySelector('[role=alert]')).toBeNull();
});

test('a nullable React content host waits for its session and detaches when cleared', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  flushSync(() => f.root.render(<EditorContent editor={null} style={size} onReady={f.ready} />));
  expect(f.element.querySelector('canvas')).toBeNull();
  flushSync(() =>
    f.root.render(<EditorContent editor={f.editor} style={size} onReady={f.ready} />),
  );
  const mounted = await f.readiness;
  expect(mounted.status).toBe('ready');
  flushSync(() => f.root.render(<EditorContent editor={null} style={size} onReady={f.ready} />));
  expect(mounted.isDestroyed).toBe(true);
  expect(f.editor.isDestroyed).toBe(false);
  expect(f.element.querySelector('canvas')).toBeNull();
});

const readingSettings = { readingView: true, label: 'Draft', description: 'Custom instructions' };

const renamedSettings = { label: 'Final' };

test('accessibility props replace declarative settings and removal restores defaults without remounting', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  flushSync(() =>
    f.root.render(
      <EditorContent
        editor={f.editor}
        style={size}
        accessibility={readingSettings}
        onReady={f.ready}
      />,
    ),
  );
  const mounted = await f.readiness;
  const input = f.element.querySelector('textarea');
  const reader = f.element.querySelector<HTMLElement>('[data-editor-reading]');
  expect(reader?.hidden).toBe(false);
  flushSync(() =>
    f.root.render(
      <EditorContent
        editor={f.editor}
        style={size}
        accessibility={renamedSettings}
        onReady={unexpectedRemount}
      />,
    ),
  );
  expect(reader?.hidden).toBe(true);
  expect(input?.getAttribute('aria-label')).toBe('Final');
  expect(document.getElementById(input?.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
    defaultAccessibility.description,
  );
  flushSync(() =>
    f.root.render(<EditorContent editor={f.editor} style={size} onReady={unexpectedRemount} />),
  );
  expect(input?.getAttribute('aria-label')).toBe(defaultAccessibility.label);
  expect(reader?.hidden).toBe(true);
  expect(f.element.querySelector('textarea')).toBe(input);
  expect(f.mounted).toBe(mounted);
});
