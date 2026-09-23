import assert from 'node:assert/strict';

import { chromium, firefox, webkit } from 'playwright';

for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();

  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } }),
        errors = [];

      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('http://127.0.0.1:5173/editor.html');
      await page.waitForFunction(() => window.editorDiagnostics);

      if (width === 1100) {
        const core = await page.evaluate(async () => {
          const { hitTestTextLines, createTextNavigation, TextSelection } = Object.assign(
            {},
            await import('/@id/@kerned/view'),
            await import('/@id/@kerned/state'),
          );

          const hits = [];

          const regions = [
            {
              id: 91,
              top: 0,
              lines: [{ top: 0, bottom: 20 }],
              hit: (x) => ({
                index: Math.max(0, Math.min(10, Math.round(x / 10))),
                upstream: false,
              }),
            },
            {
              id: 92,
              top: 100,
              lines: [{ top: 80, bottom: 100 }],
              hit: (x) => ({
                index: Math.max(0, Math.min(10, Math.round(x / 10))),
                upstream: false,
              }),
            },
          ];

          for (const [x, y] of [
            [35, -20],
            [35, 250],
            [35, 70],
          ])
            hits.push(hitTestTextLines(regions, x, y));

          const blocks = [
            { id: 91, text: 'one two three four five six seven eight', top: 0, height: 80 },
            { id: 92, text: 'tiny', top: 100, height: 20 },
            { id: 93, text: 'one two three four five six seven eight', top: 140, height: 80 },
          ];

          const layout = (id) => {
            const b = blocks.find((b) => b.id === id),
              lines = Array.from({ length: Math.ceil(b.text.length / 10) }, (_, i) => ({
                start: i * 10,
                end: Math.min(b.text.length, (i + 1) * 10),
                top: i * 20,
                bottom: (i + 1) * 20,
              }));

            return {
              lines,
              geometry: (a, h) => ({
                caret: [(h % 10) * 10, Math.floor(h / 10) * 20, 0, Math.floor(h / 10) * 20 + 20],
              }),
              hit: (x, y) => {
                const line = lines[Math.max(0, Math.min(lines.length - 1, Math.floor(y / 20)))];

                return {
                  index: Math.max(line.start, Math.min(line.end, line.start + Math.round(x / 10))),
                  upstream: false,
                };
              },
              move: (i, u, d) => ({
                index:
                  d === 'home'
                    ? Math.floor(i / 10) * 10
                    : d === 'end'
                      ? Math.min(b.text.length, (Math.floor(i / 10) + 1) * 10)
                      : Math.max(0, Math.min(b.text.length, i + (d === 'left' ? -1 : 1))),
                upstream: false,
              }),
            };
          };

          const cases = [];

          for (const platform of ['mac', 'other']) {
            const nav = createTextNavigation(),
              call = (selection, key, mods = {}) =>
                nav.move({
                  selection,
                  event: {
                    key,
                    shiftKey: false,
                    altKey: false,
                    ctrlKey: false,
                    metaKey: false,
                    ...mods,
                  },
                  blocks,
                  layout,
                  viewportHeight: 100,
                  platform,
                });

            const word = platform === 'mac' ? { altKey: true } : { ctrlKey: true };
            cases.push([
              platform,
              'word',
              call(new TextSelection({ id: 91, offset: 0 }), 'ArrowRight', word).head,
            ]);
            cases.push([
              platform,
              'shiftWord',
              call(new TextSelection({ id: 91, offset: 4 }), 'ArrowRight', {
                ...word,
                shiftKey: true,
              }).anchor,
            ]);
            cases.push([
              platform,
              'docEnd',
              call(
                new TextSelection({ id: 91, offset: 4 }),
                platform === 'mac' ? 'ArrowDown' : 'End',
                platform === 'mac' ? { metaKey: true } : { ctrlKey: true },
              ).head,
            ]);
            let v = call(new TextSelection({ id: 91, offset: 35 }), 'ArrowDown');
            v = call(v, 'ArrowDown');
            cases.push([platform, 'column', v.head]);
            cases.push([
              platform,
              'top',
              call(new TextSelection({ id: 91, offset: 5 }), 'ArrowUp').head,
            ]);
            cases.push([
              platform,
              'reserved',
              call(new TextSelection({ id: 91, offset: 5 }), 'PageDown', { ctrlKey: true }),
            ]);
          }

          return { hits, cases };
        });

        assert.deepEqual(
          core.hits.map((hit) => hit.point),
          [
            { id: 91, offset: 4 },
            { id: 92, offset: 4 },
            { id: 91, offset: 4 },
          ],
          'Hit test must choose actual line boxes, not block extent',
        );

        for (const [platform, kind, value] of core.cases) {
          const expected =
            kind === 'word'
              ? { id: 91, offset: platform === 'mac' ? 3 : 4 }
              : kind === 'shiftWord'
                ? { id: 91, offset: 4 }
                : kind === 'docEnd'
                  ? { id: 93, offset: 39 }
                  : kind === 'column'
                    ? { id: 93, offset: 5 }
                    : kind === 'top'
                      ? { id: 91, offset: 0 }
                      : null;

          assert.deepEqual(value, expected, `${platform} ${kind}`);
        }
      }

      const settle = () =>
        page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        );

      const read = () => page.evaluate(() => window.editorDiagnostics.read());

      const point = async (id, x, dy) => {
        const state = await read(),
          p = state.scene.find((p) => p.id === id),
          r = await page.getByLabel('Canvas document').boundingBox();

        return { x: r.x + 28 + x, y: r.y + p.y - state.scroll + dy };
      };

      const click = async (p) => {
        await page.mouse.click(p.x, p.y);
        await settle();

        return (await read()).selection;
      };

      let state = await read(),
        first = state.scene[0],
        last = state.scene.at(-1);

      const x = 50,
        firstLine = await point(first.id, x, 14),
        lastLine = await point(last.id, x, last.height - 14);

      const firstExpected = await click(firstLine),
        lastExpected = await click(lastLine);

      assert.deepEqual(
        await click({
          x: firstLine.x,
          y: (await page.locator('.minimal-toolbar').boundingBox()).height + 3,
        }),
        firstExpected,
        'Above content uses first line at same x',
      );
      assert.deepEqual(
        await click({ x: lastLine.x, y: 780 }),
        lastExpected,
        'Below content uses last line at same x',
      );
      const left = await click({ x: 2, y: lastLine.y });
      assert.equal(left.id, last.id);
      assert.ok(left.focus > 0, 'Left gutter must choose the final wrapped line, not block start');
      const right = await click({ x: width - 2, y: firstLine.y });
      assert.equal(right.id, first.id);
      assert.ok(
        right.focus < state.nodes[0].text.length,
        'Right gutter must choose first wrapped line, not block end',
      );
      await click(firstLine);
      await page.keyboard.down('Shift');
      await click({ x: width - 2, y: lastLine.y });
      await page.keyboard.up('Shift');
      state = await read();
      assert.equal(state.selection.anchorId, first.id);
      assert.equal(state.selection.id, last.id);
      await page.mouse.move(2, firstLine.y);
      await page.mouse.down();
      await page.mouse.move(width - 2, lastLine.y, { steps: 8 });
      await page.mouse.up();
      await settle();
      state = await read();
      assert.equal(state.selection.anchorId, first.id);
      assert.equal(state.selection.id, last.id);
      const before = state.selection;
      await page.getByRole('button', { name: 'Find', exact: true }).click();
      await settle();
      assert.deepEqual(
        (await read()).selection,
        before,
        'Interactive buttons must not relocate selection',
      );
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.editorDiagnostics.select(1, 5));
      await settle();

      const mac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform)),
        word = mac ? 'Alt' : 'Control';

      await page.keyboard.press(`${word}+Shift+ArrowRight`);
      await settle();
      state = await read();
      assert.equal(state.selection.anchor, 5);
      assert.ok(state.selection.focus > 5);
      await page.keyboard.press('Control+End');
      await settle();
      state = await read();
      assert.equal(state.selection.id, last.id);
      assert.equal(state.selection.focus, state.nodes.at(-1).text.length);
      await page.keyboard.press('Control+Shift+Home');
      await settle();
      state = await read();
      assert.equal(state.selection.id, first.id);
      assert.equal(state.selection.focus, 0);
      assert.equal(state.selection.anchorId, last.id);
      await page.keyboard.press('ArrowLeft');
      await settle();
      assert.equal((await read()).selection.id, first.id);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        name,
        width,
        'editor-wide clicks, gutters, shift/drag, controls and modifier navigation passed',
      );
    }

    // Long-document paging must hydrate destination layout and reveal the caret.
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } }),
      errors = [];

    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:5173/editor.html?sample=warbreaker');
    await page.waitForFunction(() => window.editorDiagnostics?.probe([]).complete);
    await page.evaluate(() => window.editorDiagnostics.select(1, 0));
    await page.keyboard.press('Shift+PageDown');
    await page.waitForFunction(() => window.editorDiagnostics.read().selection.id !== 1);
    let state = await page.evaluate(() => window.editorDiagnostics.read());
    assert.equal(state.selection.anchorId, 1);
    assert.ok(state.scroll > 0);
    await page.keyboard.press('Control+End');
    await page.waitForFunction(
      () =>
        window.editorDiagnostics.read().selection.id ===
        window.editorDiagnostics.read().nodes.at(-1).id,
    );
    assert.ok(await page.evaluate(() => scrollY > 10000));
    await page.keyboard.press('PageUp');
    await page.waitForFunction(
      () =>
        window.editorDiagnostics.read().selection.id !==
        window.editorDiagnostics.read().nodes.at(-1).id,
    );
    await page.keyboard.press('Control+Home');
    await page.waitForFunction(() => window.editorDiagnostics.read().selection.id === 1);
    assert.ok(await page.evaluate(() => scrollY < 40));
    assert.deepEqual(errors, []);
    await page.close();
    console.log(name, 'page movement, shift selection and distant document boundaries passed');
  } finally {
    await browser.close();
  }
}
