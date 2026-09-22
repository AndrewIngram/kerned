import { createEditor, type Editor } from '@gprose/core';
import type { DocumentNode } from '@gprose/model';
import { textSelection } from '@gprose/state';
import { StrictMode, Suspense, useLayoutEffect, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, expectTypeOf, test } from 'vitest';

import { createEditorContext, useCommandState, useEditor, useEditorState } from '../index.js';
import { ownershipFixture } from './ownership-fixture.js';

type Fixture = ReturnType<typeof ownershipFixture>;

type Session = Editor<
  Fixture['schema']['definitions'],
  DocumentNode<Fixture['schema']['definitions']>
>;

function host() {
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);

  return {
    element,
    render(children: ReactNode) {
      flushSync(() => root.render(children));
    },
    destroy() {
      flushSync(() => root.unmount());
      element.remove();
    },
  };
}

function observer() {
  let current: Session | null = null;

  return {
    observe(this: void, editor: typeof current) {
      current = editor;
    },
    get current() {
      return current;
    },
    read() {
      if (!current) throw new Error('Expected a committed editor');

      return current;
    },
  };
}

function Owned({
  schema,
  documentId,
  text,
  observe,
}: {
  schema: Fixture['schema'];
  documentId?: string;
  text: string;
  observe: ReturnType<typeof observer>['observe'];
}) {
  const editor = useEditor({ schema, documentId, content: [{ kind: 'note', text }] });
  const content = useEditorState(editor, (state) => state.nodes[0].text);
  useLayoutEffect(() => observe(editor), [editor, observe]);
  expectTypeOf(content).toEqualTypeOf<string | undefined>();
  expectTypeOf(editor?.commands.append).toEqualTypeOf<((text: string) => boolean) | undefined>();

  return <p>{content ?? 'Loading'}</p>;
}

test('Strict Mode balances resources, retains edits on rerender and replaces only document identity', ({
  onTestFinished,
}) => {
  const f = ownershipFixture();
  const h = host();
  const o = observer();
  onTestFinished(() => h.destroy());
  h.render(
    <StrictMode>
      <Owned schema={f.schema} documentId="one" text="A" observe={o.observe} />
    </StrictMode>,
  );
  const first = o.read();
  expect(f.events).toEqual(['create', 'destroy', 'create']);
  flushSync(() => first.commands.append('B'));
  expect(h.element.textContent).toBe('AB');
  h.render(
    <StrictMode>
      <Owned schema={f.schema} documentId="one" text="Overwrite" observe={o.observe} />
    </StrictMode>,
  );
  expect(o.read()).toBe(first);
  expect(h.element.textContent).toBe('AB');
  h.render(
    <StrictMode>
      <Owned schema={f.schema} documentId="two" text="C" observe={o.observe} />
    </StrictMode>,
  );
  expect(first.isDestroyed).toBe(true);
  expect(o.read()).not.toBe(first);
  expect(o.read().documentId).toBe('two');
  expect(h.element.textContent).toBe('C');
  h.render(null);
  expect(f.events).toEqual(['create', 'destroy', 'create', 'destroy', 'create', 'destroy']);
});

test('schema replacement releases the previous session; external destruction publishes null', ({
  onTestFinished,
}) => {
  const a = ownershipFixture();
  const b = ownershipFixture();
  const h = host();
  const o = observer();
  onTestFinished(() => h.destroy());
  h.render(<Owned schema={a.schema} text="A" observe={o.observe} />);
  const first = o.read();
  h.render(<Owned schema={b.schema} text="B" observe={o.observe} />);
  expect(first.isDestroyed).toBe(true);
  expect(a.events).toEqual(['create', 'destroy']);
  flushSync(() => o.read().destroy());
  expect(o.current).toBeNull();
  expect(h.element.textContent).toBe('Loading');
  h.render(null);
  expect(b.events).toEqual(['create', 'destroy']);
});

test('a suspended, abandoned render never creates extension resources', ({ onTestFinished }) => {
  const f = ownershipFixture();
  const h = host();
  onTestFinished(() => h.destroy());
  const pending = new Promise<void>(() => {});

  function Abandoned(): ReactNode {
    useEditor({ schema: f.schema, content: [{ kind: 'note', text: 'Never committed' }] });
    throw pending;
  }

  h.render(
    <Suspense fallback="Waiting">
      <Abandoned />
    </Suspense>,
  );
  expect(h.element.textContent).toBe('Waiting');
  h.render(null);
  expect(f.events).toEqual([]);
});

test('server markup hydrates without resources until commit and releases its session on unmount', async ({
  onTestFinished,
}) => {
  const f = ownershipFixture();
  const o = observer();
  const element = document.createElement('div');
  document.body.append(element);
  const content = <Owned schema={f.schema} text="Hydrated" observe={o.observe} />;
  element.innerHTML = renderToString(content);
  expect(element.textContent).toBe('Loading');
  expect(f.events).toEqual([]);
  const errors: unknown[] = [];
  const root = hydrateRoot(element, content, { onRecoverableError: (error) => errors.push(error) });
  onTestFinished(() => {
    flushSync(() => root.unmount());
    element.remove();
  });
  await expect.poll(() => element.textContent).toBe('Hydrated');
  expect(errors).toEqual([]);
  expect(f.events).toEqual(['create']);
  flushSync(() => root.render(null));
  expect(f.events).toEqual(['create', 'destroy']);
});

test('bound context keeps command types and borrows its session while selectors tolerate loading', ({
  onTestFinished,
}) => {
  const f = ownershipFixture();
  const editor = createEditor({ schema: f.schema, content: [{ kind: 'note', text: 'A' }] });
  const { EditorProvider, useCurrentEditor } = createEditorContext(f.schema);
  const h = host();
  onTestFinished(() => {
    h.destroy();
    editor.destroy();
  });
  let calls = 0;

  function Toolbar() {
    const current = useCurrentEditor();
    expectTypeOf(current?.commands.append).toEqualTypeOf<((text: string) => boolean) | undefined>();

    const text = useEditorState(current, (state) => {
      calls++;

      return state.nodes[0].text;
    });

    return <button onClick={() => current?.commands.append('B')}>{text ?? 'Waiting'}</button>;
  }

  h.render(
    <EditorProvider editor={null}>
      <Toolbar />
    </EditorProvider>,
  );
  expect(calls).toBe(0);
  h.render(
    <EditorProvider editor={editor}>
      <Toolbar />
    </EditorProvider>,
  );
  flushSync(() => h.element.querySelector('button')?.click());
  expect(h.element.textContent).toBe('AB');
  h.render(
    <EditorProvider editor={null}>
      <Toolbar />
    </EditorProvider>,
  );
  expect(h.element.textContent).toBe('Waiting');
  expect(editor.isDestroyed).toBe(false);
  h.render(null);
  expect(editor.isDestroyed).toBe(false);
});

test('toolbar selectors suppress unrelated selection renders and receive document changes', ({
  onTestFinished,
}) => {
  const f = ownershipFixture();
  const editor = createEditor({ schema: f.schema, content: [{ kind: 'note', text: 'A' }] });
  const h = host();
  onTestFinished(() => {
    h.destroy();
    editor.destroy();
  });
  const renders: string[] = [];
  const select = (state: Session['state']) => ({ text: state.nodes[0].text });
  const equal = (a: { text: string }, b: { text: string }) => a.text === b.text;

  function Label() {
    const value = useEditorState(editor, select, equal);
    expectTypeOf(value).toEqualTypeOf<{ text: string }>();
    useLayoutEffect(() => {
      renders.push(value.text);
    });

    return <p>{value.text}</p>;
  }

  h.render(<Label />);
  expect(renders).toEqual(['A']);
  flushSync(() => editor.select(textSelection(editor.state.nodes[0].id, 1)));
  expect(renders).toEqual(['A']);
  flushSync(() => editor.commands.append('B'));
  expect(renders).toEqual(['A', 'AB']);
  expect(h.element.textContent).toBe('AB');
});

test('named command selectors infer arguments and refresh activity without transaction-only rerenders', ({
  onTestFinished,
}) => {
  const f = ownershipFixture();
  const editor = createEditor({ schema: f.schema, content: [{ kind: 'note', text: 'A' }] });
  const h = host();
  onTestFinished(() => {
    h.destroy();
    editor.destroy();
  });
  const renders: string[] = [];

  function Toolbar({ session, suffix }: { session: typeof editor | null; suffix: string }) {
    const state = useCommandState(session, 'append', suffix);
    useLayoutEffect(() => {
      renders.push(state?.activity ?? 'loading');
    });

    return <p>{state?.activity ?? 'loading'}</p>;
  }

  function InvalidCommands() {
    // @ts-expect-error Only installed command names are available.
    useCommandState(editor, 'missing');
    // @ts-expect-error Named command parameters retain their schema-inferred types.
    useCommandState(editor, 'append', 42);
    // @ts-expect-error Required command parameters cannot be omitted.
    useCommandState(editor, 'append');

    return null;
  }

  expectTypeOf(InvalidCommands).toBeFunction();
  h.render(<Toolbar session={null} suffix="B" />);
  expect(h.element.textContent).toBe('loading');
  h.render(<Toolbar session={editor} suffix="B" />);
  flushSync(() => editor.commands.append('C'));
  expect(renders).toEqual(['loading', 'inactive']);
  flushSync(() => editor.commands.append('B'));
  expect(renders).toEqual(['loading', 'inactive', 'active']);
  h.render(<Toolbar session={editor} suffix="A" />);
  expect(h.element.textContent).toBe('inactive');
});
