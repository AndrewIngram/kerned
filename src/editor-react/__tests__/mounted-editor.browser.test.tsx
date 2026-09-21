import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { createEditor, defineExtension, type ContributionContext } from '../../core';
import { defineNodePresentation, presentations, type MountedEditor } from '../../editor-canvas';
import { createSchema, defineNode } from '../../model';
import { Editor } from '../editor';

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

  flushSync(() =>
    f.root.render(
      <StrictMode>
        <Editor editor={f.editor} style={size} onReady={f.ready} />
      </StrictMode>,
    ),
  );
  await f.readiness;
  expect(f.mounted?.status).toBe('ready');
  expect(f.element.querySelectorAll('canvas')).toHaveLength(1);
  f.editor.commands.focus();
  expect(document.activeElement).toBe(f.element.querySelector('textarea'));
  const first = f.mounted;
  // A callback-only rerender must preserve the mounted editor and native allocations.
  flushSync(() =>
    f.root.render(
      <StrictMode>
        <Editor editor={f.editor} style={size} onReady={unexpectedRemount} />
      </StrictMode>,
    ),
  );
  expect(f.mounted).toBe(first);
  flushSync(() => f.root.render(null));
  expect(first?.status).toBe('destroyed');
  expect(f.editor.isDestroyed).toBe(false);
  expect(f.element.querySelector('canvas')).toBeNull();
});

test('React reports asset failure and can retry without replacing the session', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());

  flushSync(() =>
    f.root.render(<Editor editor={f.editor} resolveAsset={invalidAsset} onError={f.failed} />),
  );
  await f.failure;
  expect(f.failures).toHaveLength(1);
  await expect
    .poll(() => f.element.querySelector('[role="alert"]')?.textContent)
    .toMatch(/Invalid graphics/);
  flushSync(() => f.root.render(<Editor editor={f.editor} style={size} onReady={f.ready} />));
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
      <Editor editor={f.editor} style={size} onReady={f.ready} zoom={1.25} paddingTop={16} />,
    ),
  );
  flushSync(() =>
    f.root.render(
      <Editor editor={f.editor} style={size} onReady={f.ready} zoom={1.5} paddingTop={32} />,
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
      <Editor
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
    f.root.render(<Editor editor={f.editor} style={size} onReady={unexpectedRemount} />),
  );
  expect(mounted.getSnapshot()?.zoom).toBe(1);
  expect(mounted.blockBounds(before.id)?.top).toBeCloseTo(before.top - 32);
  expect(f.element.querySelector('[zoom], [paddingtop]')).toBeNull();
});
