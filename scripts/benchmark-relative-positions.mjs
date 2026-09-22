import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';

import { chromium } from 'playwright';

import { createBrowserFixtureServer } from './browser-fixture-server.mjs';

const directory = process.env.REPORT_DIR ?? 'artifacts/editor-foundation-relative-index';

const fixtureServer = await createBrowserFixtureServer();

const browser = await chromium.launch();

try {
  const page = await browser.newPage();
  await page.goto(fixtureServer.url);

  const results = await page.evaluate(async () => {
    const { fixture, dispatch, capture } = await import('/tests/fixtures/editor-foundation.js');
    const rows = [];

    for (let trial = 0; trial < 3; trial++)
      for (const edits of [100, 1000, 10000]) {
        const editor = fixture(),
          before = JSON.stringify(editor.positions.checkpoint());

        const ranges = Array.from({ length: 1000 }, () => capture(editor, 3, 0, 5));

        if (before !== JSON.stringify(editor.positions.checkpoint()))
          throw new Error('Ranges mutated position storage');

        for (let i = 0; i < edits; i++)
          dispatch(editor, [
            { kind: 'replaceText', id: 3, from: 9, to: 10, text: i % 2 ? 'b' : 'B' },
          ]);
        editor.compactJournal();
        const coldStart = performance.now();
        editor.positions.resolveRange(ranges[0]);
        const coldMs = performance.now() - coldStart;
        const start = performance.now();

        for (const range of ranges) {
          const resolved = editor.positions.resolveRange(range);

          if (
            resolved.status !== 'resolved' ||
            resolved.ranges[0].from !== 0 ||
            resolved.ranges[0].to !== 5
          )
            throw new Error('Incorrect range');
        }

        const resolve1000Ms = performance.now() - start,
          checkpoint = editor.positions.checkpoint();

        rows.push({
          trial,
          edits,
          ranges: ranges.length,
          coldMs,
          resolve1000Ms,
          checkpointBytes: new TextEncoder().encode(JSON.stringify(checkpoint)).length,
          definitions: checkpoint.definitions.length,
          events: checkpoint.events.length,
        });
      }

    return rows;
  });

  const varied = await page.evaluate(async () => {
    const { schema, dispatch, capture } = await import('/tests/fixtures/editor-foundation.js');
    const { createEditor, textSelection } = await import('/@id/@gprose/state');
    const rows = [];

    for (let trial = 0; trial < 3; trial++)
      for (const scenario of [
        'before',
        'interior',
        'boundary',
        'other-blocks',
        'mixed-revisions',
        'mixed-revisions-undo',
      ]) {
        const nodes = Array.from({ length: 100 }, (_, i) => ({
          id: i + 1,
          key: `p-${i + 1}`,
          kind: 'text',
          role: 'body',
          value: 'x'.repeat(128),
        }));

        const editor = createEditor(schema, nodes, textSelection(1, 0));

        const ranges = Array.from({ length: 1000 }, (_, i) => {
          const from = scenario === 'interior' ? i % 10 : 20 + (i % 10);

          return capture(
            editor,
            Math.floor(i / 10) + 1,
            from,
            scenario === 'boundary' ? 64 : scenario === 'interior' ? 90 + (i % 10) : from + 5,
          );
        });

        for (let i = 0; i < 10000; i++) {
          if (scenario.startsWith('mixed-revisions') && i % 10 === 0) {
            const r = i / 10,
              id = Math.floor(r / 10) + 1;

            ranges[r] = capture(editor, id, 20 + (r % 10), 25 + (r % 10));
          }

          const id = (i % 100) + 1,
            from = scenario === 'before' ? 0 : 64;

          dispatch(editor, [
            { kind: 'replaceText', id, from, to: from + 1, text: i % 2 ? 'a' : 'b' },
          ]);
        }

        if (scenario === 'mixed-revisions-undo') {
          editor.undo();
          editor.redo();
          editor.undo();
        }

        if (scenario === 'before')
          for (let id = 1; id <= 100; id++)
            dispatch(editor, [{ kind: 'replaceText', id, from: 0, to: 0, text: '++' }]);
        const passes = [];

        for (let frame = 0; frame < 12; frame++) {
          // Force fresh indexes after an edit, as an actual decoration pass would.
          dispatch(editor, [{ kind: 'replaceText', id: 1, from: 110, to: 111, text: 'z' }]);
          const start = performance.now();

          for (const [i, range] of ranges.entries()) {
            const result = editor.positions.resolveRange(range),
              shift = scenario === 'before' ? 2 : 0;

            if (
              result.status !== 'resolved' ||
              result.ranges[0].id !== Math.floor(i / 10) + 1 ||
              result.ranges[0].from !== range.start.offset + shift ||
              result.ranges[0].to !== range.end.offset + shift
            )
              throw new Error(`Incorrect ${scenario} range`);
          }

          passes.push(performance.now() - start);
        }

        rows.push({
          trial,
          scenario,
          ranges: 1000,
          edits: editor.state.revision,
          coldPassMs: [...passes].toSorted((a, b) => a - b)[Math.floor(passes.length / 2)],
          maxPassMs: Math.max(...passes),
          samples: passes,
        });
      }

    return rows;
  });

  assert.equal(results.length, 9);
  await mkdir(directory, { recursive: true });

  const report = {
    recordedAt: new Date().toISOString(),
    cpu: os.cpus()[0]?.model,
    browser: browser.version(),
    methodology:
      'Three serial trials; independent 1000 externally held ranges; fixed-size text edits outside the ranges; cold first resolution then shared-suffix-cache batch; serialized checkpoint size, not heap size; varied scenarios use 1000 distinct ranges across 100 blocks and rebuild after each edit',
    results,
    varied,
  };

  await writeFile(`${directory}/positions.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ results, varied }, null, 2));

  const slow = results
    .filter((row) => row.edits === 10000)
    .map((row) => row.coldMs + row.resolve1000Ms)
    .toSorted((a, b) => a - b);

  for (const scenario of new Set(varied.map((row) => row.scenario))) {
    const samples = varied
      .filter((row) => row.scenario === scenario)
      .map((row) => row.coldPassMs)
      .toSorted((a, b) => a - b);

    assert.ok(samples[1] < 16, `${scenario} lookup budget exceeded: ${samples[1].toFixed(1)} ms`);
  }

  assert.ok(
    slow[1] < 16,
    `Old-range lookup budget exceeded: ${slow[1].toFixed(1)} ms, expected <16 ms including cold index build`,
  );
} finally {
  await browser.close();
  await fixtureServer.close();
}
