import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import { chromium } from 'playwright';

const browser = await chromium.launch();

try {
  const page = await browser.newPage();
  await page.routeWebSocket(
    (url) => url.pathname === '/',
    () => {},
  );
  await page.goto('http://127.0.0.1:5173/editor.html');
  let cdp;

  if (process.env.PROFILE) {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');
  }

  const results = await page.evaluate(async () => {
    const { createEditor, TextSelection, createAnchor, resolveAnchor } =
      await import('/@id/@gprose/state');

    const { demoSchema } = await import('/src/extensions/demo-schema.ts');
    const { replaceStructuredText } = await import('/src/extensions/blocks.ts');
    const reports = [];

    const check = (condition, message) => {
      if (!condition) throw new Error(message);
    };

    const same = (a, b, message) => check(JSON.stringify(a) === JSON.stringify(b), message);

    const leaf = (id, text = 'Editable content.') => ({
      id,
      key: `p-${id}`,
      kind: 'paragraph',
      text,
      marks: [],
      inline: [],
    });

    const apply = (editor, command) =>
      editor.dispatch({
        baseRevision: editor.state.revision,
        origin: 'local',
        history: 'separate',
        time: 0,
        ...command,
      });

    const first = {
      ...leaf(1, 'Hello world'),
      kind: 'heading',
      level: 2,
      marks: [{ from: 0, to: 5, mark: { type: 'bold', attrs: null } }],
    };

    const last = {
      ...leaf(4, 'Goodbye world'),
      marks: [{ from: 5, to: 13, mark: { type: 'italic', attrs: null } }],
    };

    const table = {
      id: 40,
      key: 'table',
      kind: 'table',
      caption: 'Embedded',
      rows: [
        [
          {
            id: 41,
            key: 'cell',
            kind: 'tableCell',
            row: 0,
            header: false,
            colspan: 1,
            rowspan: 1,
            paragraphs: [leaf(42, 'Cell text')],
          },
        ],
      ],
    };

    const initial = [
      leaf(100, 'Before'),
      {
        id: 20,
        key: 'quote-1',
        kind: 'quote',
        children: [
          first,
          {
            id: 30,
            key: 'list',
            kind: 'list',
            ordered: true,
            start: 3,
            children: [
              { id: 31, key: 'item-1', kind: 'listItem', children: [leaf(2)] },
              { id: 32, key: 'item-2', kind: 'listItem', children: [leaf(3)] },
            ],
          },
        ],
      },
      table,
      { id: 21, key: 'quote-2', kind: 'quote', children: [last, leaf(5, 'Keep this sibling')] },
      leaf(6, 'After'),
    ];

    for (const inserted of ['', 'New text']) {
      const selection = new TextSelection({ id: 4, offset: 4 }, { id: 1, offset: 3 });

      const bulk = createEditor(demoSchema, initial, selection),
        reference = createEditor(demoSchema, initial, selection);

      const anchors = [1, 2, 3, 4, 5, 42, 100].flatMap((id) =>
        [0, 2].flatMap((offset) =>
          [-1, 1].map((bias) => createAnchor(demoSchema, bulk.state, 'doc', id, offset, bias)),
        ),
      );

      anchors.push(createAnchor(demoSchema, bulk.state, 'doc', 4, 8, 1));
      const command = replaceStructuredText(demoSchema, bulk.state, inserted);
      const result = apply(bulk, command);
      // Independent sequential operations are the pre-existing editing contract.
      apply(reference, {
        selection: command.selection,
        steps: [
          { kind: 'removeChildren', parent: null, index: 2, count: 1 },
          { kind: 'moveChildren', parent: 31, index: 0, count: 1, toParent: 20, toIndex: 1 },
          { kind: 'moveChildren', parent: 32, index: 0, count: 1, toParent: 20, toIndex: 2 },
          { kind: 'moveChildren', parent: 21, index: 0, count: 1, toParent: 20, toIndex: 3 },
          { kind: 'removeChildren', parent: 20, index: 4, count: 1 },
          { kind: 'replaceText', id: 4, from: 0, to: 4, text: '' },
          { kind: 'replaceText', id: 3, from: 0, to: 17, text: '' },
          { kind: 'replaceText', id: 2, from: 0, to: 17, text: '' },
          { kind: 'replaceText', id: 1, from: 3, to: 11, text: inserted },
          { kind: 'join', left: 1, right: 2 },
          { kind: 'join', left: 1, right: 3 },
          { kind: 'join', left: 1, right: 4 },
        ],
      });
      same(
        bulk.state.nodes,
        reference.state.nodes,
        'Partial backward replacement preserves structure and marks',
      );
      check(
        bulk.state.nodes[0] === initial[0] && bulk.state.nodes.at(-1) === initial.at(-1),
        'Unaffected roots retain identity',
      );
      check(
        bulk.state.nodes[1].children[0].text === `Hel${inserted}bye world`,
        'Boundary text joins at the deletion point',
      );
      check(result.changes.length === 1, 'Bulk replacement publishes once');

      for (let offset = 0; offset <= 3 + inserted.length + 9; offset++)
        for (const bias of [-1, 1])
          anchors.push(createAnchor(demoSchema, bulk.state, 'doc', 1, offset, bias));

      const resolve = (editor) =>
        anchors.map((anchor) =>
          resolveAnchor(demoSchema, anchor, 'doc', editor.state, editor.journal),
        );

      same(
        resolve(bulk),
        resolve(reference),
        'Durable anchors match individual replacement/join steps',
      );
      const streamed = leaf(200, 'Stream arrival');

      for (const editor of [bulk, reference])
        editor.dispatch({
          baseRevision: editor.state.revision,
          origin: 'stream',
          history: 'exclude',
          steps: [{ kind: 'append', nodes: [streamed] }],
        });
      bulk.undo();
      reference.undo();
      same(bulk.state.nodes, [...initial, streamed], 'Undo preserves a later stream arrival');
      same(resolve(bulk), resolve(reference), 'Undo maps anchors consistently');
      bulk.redo();
      reference.redo();
      same(bulk.state.nodes, reference.state.nodes, 'Redo retains the stream and replacement');
      same(resolve(bulk), resolve(reference), 'Redo maps anchors consistently');
    }

    const atomic = createEditor(
      demoSchema,
      [leaf(1, 'a😀b'), leaf(2)],
      new TextSelection({ id: 1, offset: 0 }),
    );

    for (const step of [
      { ranges: [{ kind: 'text', id: 1, from: 2, to: 3 }], pruneEmpty: [] },
      {
        ranges: [
          { kind: 'text', id: 1, from: 0, to: 1 },
          { kind: 'text', id: 1, from: 0, to: 1 },
        ],
        pruneEmpty: [],
      },
      {
        ranges: [
          { kind: 'text', id: 2, from: 0, to: 1 },
          { kind: 'text', id: 1, from: 0, to: 1 },
        ],
        pruneEmpty: [],
      },
      { ranges: [{ kind: 'text', id: 1, from: 0, to: 1 }], pruneEmpty: [2] },
    ]) {
      const before = atomic.state;
      let rejected = false;

      try {
        apply(atomic, { steps: [{ kind: 'replaceRanges', text: '', ...step }] });
      } catch {
        rejected = true;
      }

      check(
        rejected &&
          atomic.state === before &&
          atomic.history.undo === 0 &&
          atomic.journal.length === 0,
        'Invalid bulk replacement is atomic',
      );
    }

    const merging = createEditor(
      demoSchema,
      [leaf(1, 'ex'), leaf(2, '\u0301b')],
      new TextSelection({ id: 1, offset: 1 }, { id: 2, offset: 0 }),
    );

    let invalidJoin = false;

    try {
      apply(merging, replaceStructuredText(demoSchema, merging.state, ''));
    } catch {
      invalidJoin = true;
    }

    check(
      invalidJoin && merging.history.undo === 0,
      'Joining boundaries must not split a newly combined grapheme',
    );

    for (const count of [100, 500])
      for (const mode of ['flat', 'nested', 'selection-api']) {
        const nested = mode === 'nested';
        const leaves = Array.from({ length: count }, (_, i) => leaf(i + 1));

        const nodes = leaves.map((node, i) =>
          nested ? { id: count + i + 1, key: `q-${i}`, kind: 'quote', children: [node] } : node,
        );

        nodes.splice(count / 2, 0, {
          id: count * 2 + 1,
          key: 'atom',
          kind: 'image',
          src: '',
          alt: '',
        });
        let visits = 0;

        const schema = {
          ...demoSchema,
          resolve(node) {
            visits++;

            return demoSchema.resolve(node);
          },
        };

        const editor = createEditor(
          schema,
          nodes,
          new TextSelection({ id: 1, offset: 0 }, { id: count, offset: 17 }),
        );

        visits = 0;
        let started = performance.now();

        const command =
          mode === 'selection-api'
            ? editor.selectionEdit('')
            : replaceStructuredText(schema, editor.state, '');

        const planMs = performance.now() - started,
          planVisits = visits;

        visits = 0;
        started = performance.now();

        const result = editor.dispatch({
          baseRevision: 0,
          origin: 'local',
          history: 'separate',
          time: 0,
          ...command,
        });

        const applyMs = performance.now() - started,
          applyVisits = visits;

        const after = JSON.stringify(editor.state.nodes);
        started = performance.now();
        editor.undo();
        const undoMs = performance.now() - started;
        const restored = JSON.stringify(editor.state.nodes) === JSON.stringify(nodes);
        editor.redo();
        reports.push({
          count,
          mode,
          planMs,
          applyMs,
          undoMs,
          planVisits,
          applyVisits,
          changes: result.changes.length,
          restored,
          redone: JSON.stringify(editor.state.nodes) === after,
        });
      }

    return reports;
  });

  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    await writeFile(process.env.PROFILE, JSON.stringify(profile));
  }

  console.log(JSON.stringify(results, null, 2));

  for (const result of results) {
    assert.ok(
      result.restored && result.redone,
      'Bulk delete must round-trip exact structure through history',
    );
    assert.ok(
      result.planVisits + result.applyVisits < result.count * 100,
      'Deleting a range must use a bounded number of tree passes',
    );
    assert.ok(
      result.changes < 10,
      'History must retain the replacement, not thousands of intermediate documents',
    );
  }
} finally {
  await browser.close();
}
