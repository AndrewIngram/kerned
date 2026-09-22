import assert from 'node:assert/strict';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5173';

import { chromium } from 'playwright';

const browser = await chromium.launch();

try {
  const page = await browser.newPage();
  await page.routeWebSocket(
    (url) => url.pathname === '/',
    () => {},
  );
  await page.goto(`${baseURL}/editor.html`);

  const result = await page.evaluate(async () => {
    const { createEditor, createSchema, defineNode, textSelection } = Object.assign(
      {},
      await import('/@id/@gprose/state'),
      await import('/@id/@gprose/model'),
    );

    let visits = 0;

    const { z } = await import('/node_modules/zod/index.js');

    const compiled = createSchema({
      extensions: [
        defineNode({
          name: 'text',
          version: 1,
          options: {},
          schema: () => ({
            attributes: z.strictObject({ text: z.string() }),
            content: { kind: 'text', field: 'text' },
          }),
        }),
        defineNode({
          name: 'group',
          version: 1,
          options: {},
          schema: () => ({
            attributes: z.strictObject({}),
            content: { kind: 'container', field: 'children' },
          }),
        }),
      ],
    });

    const schema = compiled;

    const counted = {
      ...schema,
      resolve(node) {
        visits++;

        return schema.resolve(node);
      },
    };

    const leaf = (id) => ({ id, key: `p-${id}`, kind: 'text', text: 'Text' });

    const initial = [
      leaf(1),
      { id: 2, key: 'group', kind: 'group', children: [leaf(-1), leaf(-3)] },
      ...Array.from({ length: 400 }, (_, i) => leaf(i + 3)),
    ];

    const editor = createEditor(counted, initial, textSelection(1, 0));
    visits = 0;

    const ids = Array.from({ length: 400 }, () => editor.allocateBlockId()),
      allocationVisits = visits;

    const existing = new Set([1, 2, -1, -3, ...initial.slice(2).map((n) => n.id)]);
    const unique = ids.every((id) => !existing.has(id)) && new Set(ids).size === ids.length;
    editor.select(textSelection(1, 2));
    visits = 0;
    editor.allocateBlockId();
    const selectionVisits = visits;
    const collision = editor.allocateBlockId() - 1;
    editor.dispatch({
      baseRevision: editor.state.revision,
      origin: 'stream',
      history: 'exclude',
      steps: [{ kind: 'append', nodes: [leaf(collision)] }],
    });
    const afterStream = editor.allocateBlockId();
    editor.dispatch({
      baseRevision: editor.state.revision,
      origin: 'local',
      history: 'separate',
      time: 0,
      steps: [{ kind: 'insertChildren', parent: 2, index: 0, nodes: [leaf(afterStream - 1)] }],
    });
    const afterInsert = editor.allocateBlockId();
    editor.undo();
    const afterUndo = editor.allocateBlockId();
    editor.redo();
    const afterRedo = editor.allocateBlockId();

    return {
      allocationVisits,
      selectionVisits,
      unique,
      avoidedStream: afterStream !== collision,
      avoidedNested: afterInsert !== afterStream - 1,
      monotonic: afterRedo < afterUndo && afterUndo < afterInsert,
    };
  });

  console.log(JSON.stringify(result));
  assert.ok(
    result.unique && result.avoidedStream && result.avoidedNested && result.monotonic,
    'Allocation must stay collision-free across nested edits, stream arrivals and history',
  );
  assert.ok(
    result.allocationVisits < 1000,
    'Allocating many IDs must scan the document at most once',
  );
  assert.equal(result.selectionVisits, 0, 'Selection changes must not invalidate the ID cache');
} finally {
  await browser.close();
}
