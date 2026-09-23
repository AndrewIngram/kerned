import assert from 'node:assert/strict';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5173';

import { chromium } from 'playwright';

const browser = await chromium.launch();

try {
  const page = await browser.newPage();
  await page.goto(`${baseURL}/editor.html`);

  const result = await page.evaluate(async () => {
    const {
      createSchema,
      defineNode,
      createEditor,
      textSelection,
      indexTree,
      createAnchor,
      resolveAnchor,
    } = Object.assign({}, await import('/@id/@kerned/model'), await import('/@id/@kerned/state'));

    const checks = [];

    const check = (ok, message) => {
      if (!ok) throw new Error(message);
      checks.push(message);
    };

    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    const { z } = await import('/node_modules/zod/index.js');

    const compiled = createSchema({
      extensions: [
        defineNode({
          name: 'text',
          version: 1,
          options: {},
          schema: () => ({
            attributes: z.strictObject({ text: z.string(), bold: z.boolean() }),
            content: { kind: 'text', field: 'text' },
          }),
        }),
        defineNode({
          name: 'group',
          version: 1,
          options: {},
          schema: () => ({
            attributes: z.strictObject({ label: z.string() }),
            content: { kind: 'container', field: 'children' },
          }),
        }),
      ],
    });

    const schema = compiled;

    const leaf = (id) => ({
      id,
      key: `p-${id}`,
      kind: 'text',
      text: `Paragraph ${id}`,
      bold: false,
    });

    const group = (id, children) => ({
      id,
      key: `g-${id}`,
      kind: 'group',
      children,
      label: 'before',
    });

    const dispatch = (editor, steps) =>
      editor.dispatch({
        baseRevision: editor.state.revision,
        origin: 'local',
        history: 'separate',
        time: 0,
        steps,
      });

    const resolutions = [];

    for (const count of [100, 400])
      for (const nested of [false, true]) {
        const leaves = Array.from({ length: count }, (_, i) => leaf(i + 1));
        const initial = nested ? [group(count + 1, [group(count + 2, leaves)])] : leaves;
        let visits = 0;

        const counted = {
          ...schema,
          resolve(node) {
            visits++;

            return schema.resolve(node);
          },
        };

        const editor = createEditor(counted, initial, textSelection(1, 0));
        const anchor = createAnchor(schema, editor.state, 'bulk', count, 3, 1);
        visits = 0;
        const start = performance.now();

        const applied = dispatch(
          editor,
          leaves.map((node) => ({ kind: 'updateBlock', node: { ...node, bold: true } })),
        );

        resolutions.push({ count, nested, visits, ms: performance.now() - start });
        check(
          indexTree(schema, editor.state.nodes).order.every(
            ({ node }) => node.kind !== 'text' || node.bold,
          ),
          'All leaves updated',
        );
        check(
          same(initial, nested ? [group(count + 1, [group(count + 2, leaves)])] : leaves) &&
            leaves.every((n) => !n.bold),
          'Old nodes stay immutable',
        );
        check(
          leaves.every((n) => applied.changedIds.includes(n.id)),
          'Changed leaf IDs included',
        );

        if (nested)
          check(
            applied.changedIds.includes(count + 1) && applied.changedIds.includes(count + 2),
            'Changed ancestors included',
          );
        check(
          applied.maps.length === 0 && applied.anchorMaps.length === 0,
          'Formatting has no text mapping',
        );
        const resolved = resolveAnchor(schema, anchor, 'bulk', editor.state, editor.journal);
        check(
          resolved.status === 'resolved' && resolved.anchor.offset === 3,
          'Anchor survives bulk update',
        );
        const updated = editor.state.nodes;
        const arrival = leaf(count + 10);
        editor.dispatch({
          baseRevision: editor.state.revision,
          origin: 'stream',
          history: 'exclude',
          steps: [{ kind: 'append', nodes: [arrival] }],
        });
        editor.undo();
        check(
          same(editor.state.nodes, [...initial, arrival]),
          'Single undo preserves stream arrival',
        );
        editor.redo();
        check(
          same(editor.state.nodes, [...updated, arrival]),
          'Single redo preserves stream arrival',
        );
      }

    const a = leaf(1),
      b = leaf(2),
      parent = group(3, [a, b]);

    const editor = createEditor(schema, [parent], textSelection(1, 0));
    dispatch(editor, [
      { kind: 'updateBlock', node: { ...parent, label: 'after' } },
      { kind: 'updateBlock', node: { ...a, bold: true } },
      { kind: 'updateBlock', node: { ...a, bold: false } },
    ]);
    check(
      editor.state.nodes[0].label === 'after' && !editor.state.nodes[0].children[0].bold,
      'Parent then child and repeated updates keep sequential semantics',
    );

    const before = editor.state,
      history = editor.history;

    for (const invalid of [
      [
        { kind: 'updateBlock', node: { ...a, bold: true } },
        { kind: 'updateBlock', node: parent },
      ],
      [
        { kind: 'updateBlock', node: { ...a, bold: true } },
        { kind: 'updateBlock', node: { ...b, text: 'illegal' } },
      ],
      [
        { kind: 'updateBlock', node: { ...a, bold: true } },
        { kind: 'updateBlock', node: { ...b, key: 'illegal' } },
      ],
      [
        { kind: 'updateBlock', node: { ...a, bold: true } },
        { kind: 'updateBlock', node: leaf(999) },
      ],
    ]) {
      let rejected = false;

      try {
        dispatch(editor, invalid);
      } catch {
        rejected = true;
      }

      check(
        rejected && editor.state === before && same(history, editor.history),
        'Invalid batch fails atomically',
      );
    }

    dispatch(editor, [
      { kind: 'updateBlock', node: { ...a, bold: true } },
      { kind: 'replaceText', id: 2, from: 0, to: 0, text: 'New ' },
      { kind: 'updateBlock', node: { ...a, bold: false } },
    ]);
    check(
      editor.state.nodes[0].children[1].text === 'New Paragraph 2',
      'Mixed text and property steps retain order',
    );
    editor.undo();
    check(same(editor.state.nodes, before.nodes), 'Mixed transaction undoes in one action');

    return { checks: checks.length, resolutions };
  });

  console.log(JSON.stringify(result, null, 2));

  for (const row of result.resolutions)
    assert.ok(
      row.visits < row.count * 12,
      `Bulk updates must visit nodes linearly: ${JSON.stringify(row)}`,
    );
} finally {
  await browser.close();
}
