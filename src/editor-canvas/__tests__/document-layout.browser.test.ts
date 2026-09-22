import { createEditor } from '@gprose/core';
import { createSchema, defineNode, type DocumentNode } from '@gprose/model';
import { textSelection } from '@gprose/state';
import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm';
import { beforeAll, expect, test } from 'vitest';
import { z } from 'zod';

import { createDocumentQuery } from '../../editor-browser/document';
import { createOwnedEngine } from '../../owned-layout';
import { createDocumentLayout, type DocumentLayoutFrame } from '../document-layout';
import type { BlockPresentation } from '../scene';

let kit: CanvasKit;

beforeAll(async () => {
  kit = await CanvasKitInit({ locateFile: () => '/engines/canvaskit.wasm' });
});

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.strictObject({ body: z.string() }),
    content: { kind: 'text', field: 'body' },
  }),
});

const section = defineNode({
  name: 'section',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.strictObject({}),
    content: { kind: 'container', field: 'items', allowedGroups: ['block'] },
  }),
});

const grid = defineNode({
  name: 'grid',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.strictObject({}),
    content: { kind: 'container', field: 'cells', allowedGroups: ['block'] },
  }),
});

const definitions = [note, section, grid] as const;

const schema = createSchema({ extensions: definitions });

type Node = DocumentNode<typeof definitions>;

type Block = Extract<Node, { kind: 'note' | 'grid' }>;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function fixture() {
  const owned = await createOwnedEngine(kit, 'shaping');

  const notes = Array.from({ length: 30 }, (_, id) =>
    schema
      .node(note)
      .create(
        { id, key: `note-${id}` },
        { body: `Note ${id}. Words wrap across the width of this view.` },
      ),
  );

  const editor = createEditor({
    schema,
    selection: textSelection(0, 0),
    document: [
      schema.node(section).create({ id: 100, key: 'section' }, {}, notes),
      schema
        .node(grid)
        .create({ id: 200, key: 'grid' }, {}, [
          schema.node(note).create({ id: 201, key: 'cell' }, { body: 'Inside the custom widget' }),
        ]),
    ],
  });

  const query = createDocumentQuery<Node, Block, { inset: number }>(schema, {
    initial: { inset: 0 },
    isBlock: (node): node is Block => node.kind !== 'section',
    child: (_parent, _index, context) => ({ inset: context.inset + 16 }),
  });

  const controller = createDocumentLayout({
    owned,
    source: { getSnapshot: () => query(editor.state), subscribe: editor.subscribe },
    present: (node: Block): BlockPresentation =>
      node.kind === 'note'
        ? {
            kind: 'text',
            text: node.body,
            size: 18,
            lineHeight: 30,
            baselineGrid: 0,
            before: 0,
            after: 12,
            spans: [],
            atoms: [],
          }
        : { kind: 'box', height: 70, baselineGrid: 0, before: 12, after: 12 },
  });

  let top = 0;
  let publications = 0;

  const frame: DocumentLayoutFrame<Block> = {
    viewport: {
      width: 400,
      zoom: 1,
      viewportHeight: 180,
      readScroll: () => top,
      scrollDocumentTo: (value) => {
        top = value;
      },
    },
    pinned: [],
    paddingTop: 0,
    eager: true,
    retainAll: false,
    onLayout() {},
  };

  const stop = controller.subscribe(() => {
    publications++;
  });

  controller.attach();
  controller.update(frame);
  controller.present(controller.getSnapshot());

  return {
    editor,
    controller,
    frame,
    publications: () => publications,
    destroy() {
      stop();
      controller.destroy();
      editor.destroy();
      owned.destroy();
    },
  };
}

test('generic layout follows nested text transactions and resolves caret geometry without starter-kit code', async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(() => f.destroy());
  const initial = f.controller.getSnapshot();
  expect(initial.scene.placements).toHaveLength(31);
  expect(initial.visible.length).toBeLessThan(10);
  expect(initial.caret?.[0]).toBe(16);
  f.editor.transact((context) => {
    context.step({ kind: 'replaceText', id: 0, from: 0, to: 0, text: 'Extra words '.repeat(12) });

    return true;
  });
  await nextFrame();
  const changed = f.controller.getSnapshot();
  expect(changed.scene.placements[0].height).toBeGreaterThan(initial.scene.placements[0].height);
  expect(initial.scene.placements[0].node).toMatchObject({
    body: 'Note 0. Words wrap across the width of this view.',
  });
  f.editor.select(textSelection(15, 3));
  await nextFrame();
  const selected = f.controller.getSnapshot();
  expect(selected.activePlacement?.node.id).toBe(15);
  expect(selected.visible.some((p) => p.node.id === 15)).toBe(true);
  expect(selected.caret).toEqual(selected.activePlacement?.layout?.geometry(3, 3, false).caret);
});

test('selected descendants pin their rendered container, and destroying layout leaves the borrowed session usable', async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(() => f.destroy());
  expect(f.controller.getSnapshot().visible.some((p) => p.node.id === 200)).toBe(false);
  f.editor.select(textSelection(201, 5));
  await nextFrame();
  const selected = f.controller.getSnapshot();
  expect(selected.activePlacement?.node.id).toBe(200);
  expect(selected.visible.some((p) => p.node.id === 200)).toBe(true);
  expect(selected.caret).toBeUndefined();
  f.controller.measure(200, selected.contentWidth, 130);
  await nextFrame();
  await nextFrame();
  expect(f.controller.getSnapshot().activePlacement?.height).toBe(130);
  f.controller.destroy();
  const count = f.publications();
  f.editor.transact((context) => {
    context.step({ kind: 'replaceText', id: 201, from: 0, to: 0, text: 'Still editable. ' });

    return true;
  });
  await nextFrame();
  expect(f.editor.isDestroyed).toBe(false);
  expect(f.publications()).toBe(count);
  expect(() => f.controller.update(f.frame)).toThrow(/destroyed/);
});
