import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { chromium, firefox, webkit } from 'playwright';

const base = process.env.EDITOR_URL ?? 'http://127.0.0.1:5176/extensions.html';

const html = await readFile('public/samples/warbreaker.html', 'utf8');

const manifest = JSON.parse(await readFile('public/samples/warbreaker.json', 'utf8'));

assert.equal(createHash('sha256').update(html).digest('hex'), manifest.htmlSha256);

const fullHtml = await readFile('public/samples/warbreaker-full.html', 'utf8');

const fullManifest = JSON.parse(await readFile('public/samples/warbreaker-full.json', 'utf8'));

assert.equal(createHash('sha256').update(fullHtml).digest('hex'), fullManifest.htmlSha256);

const results = [];

for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();

  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 950 } }),
      errors = [];

    page.on('pageerror', (error) => errors.push(error.message));
    const url = new URL(base);
    url.search = 'sample=warbreaker&paused=1';
    await page.goto(url.href);
    await page.waitForFunction(() => window.editorDiagnostics);

    const settle = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );

    await settle();
    assert.equal(await page.getByLabel('Sample').inputValue(), 'warbreaker');
    assert.equal((await page.evaluate(() => window.editorDiagnostics.probe([]))).count, 32);

    const parsed = await page.evaluate(() => {
      const parse = window.editorDiagnostics.importHtml;

      const marked = parse(
        '<h2>Heading</h2><p> one <strong>two <em>three</em></strong> <u>four</u><br>five &amp; six</p>',
      );

      const inert = parse(
        '<p onclick="window.injected=true">Safe<script>window.injected=true</script><style>BAD</style><img src="/never-load" onerror="window.injected=true"><iframe src="/never-load">BAD</iframe><svg><text>BAD</text></svg> text</p>',
      );

      const table = parse(
        '<table><tr><td><p>A</p></td><td>B</td></tr></table><p><a href="javascript:alert(1)">Link</a><sup>2</sup></p>',
      );

      const combining = parse('<p><strong>e</strong>\u0301lan</p>');
      const empty = parse('<script>bad()</script><p> </p>');

      return { marked, inert, table, combining, empty, injected: !!window.injected };
    });

    assert.deepEqual(
      parsed.marked.nodes.map((n) => n.text),
      ['Heading', 'one two three four\nfive & six'],
    );
    assert.deepEqual(parsed.marked.nodes[1].marks, [
      { from: 4, to: 13, mark: { type: 'bold', attrs: null } },
      { from: 8, to: 13, mark: { type: 'italic', attrs: null } },
      { from: 14, to: 18, mark: { type: 'underline', attrs: null } },
    ]);
    assert.equal(parsed.marked.nodes[0].kind, 'heading');
    assert.equal(parsed.marked.nodes[0].level, 2);
    assert.deepEqual(
      parsed.inert.nodes.filter((node) => node.kind === 'paragraph').map((node) => node.text),
      ['Safe', 'text'],
    );
    assert.deepEqual(
      parsed.inert.nodes.find((node) => node.kind === 'image'),
      {
        kind: 'image',
        id: parsed.inert.nodes[1].id,
        key: parsed.inert.nodes[1].key,
        src: '/never-load',
        alt: '',
      },
    );
    assert.equal(parsed.injected, false);
    assert.deepEqual(
      parsed.table.nodes.map((n) => n.kind),
      ['table', 'paragraph'],
    );
    assert.deepEqual(
      parsed.table.nodes[0].rows[0].map((c) => c.paragraphs[0].text),
      ['A', 'B'],
    );
    assert.equal(parsed.table.nodes[1].text, 'Link2');
    assert.equal(parsed.table.tables, 1);
    assert.equal(parsed.table.conversions.links, 1);
    assert.equal(parsed.combining.nodes[0].marks[0].to, 2);
    assert.deepEqual(
      parsed.empty.nodes.map((node) => ({ kind: node.kind, text: node.text })),
      [{ kind: 'paragraph', text: '' }],
    );

    // Underline survives split/join/undo while source blocks are still arriving.
    const first = await page.evaluate(() => window.editorDiagnostics.probe([3]).nodes[0]);
    const underlined = first.marks.find((s) => s.mark.type === 'underline');
    assert.ok(underlined);
    await page.evaluate((at) => window.editorDiagnostics.select(3, at), underlined.from + 2);
    await settle();
    await page.keyboard.press('Enter');
    await settle();
    const split = await page.evaluate(() => window.editorDiagnostics.read().selection.id);
    assert.ok(split < 0);
    await page.keyboard.press('Backspace');
    await settle();
    assert.deepEqual(
      await page.evaluate(() => window.editorDiagnostics.probe([3]).nodes[0]),
      first,
    );
    await page.evaluate(() => window.editorDiagnostics.select(3, 0));
    await settle();
    await page.keyboard.type('Edited ');
    await settle();
    assert.ok(
      (await page.evaluate(() => window.editorDiagnostics.probe([3]).nodes[0].text)).startsWith(
        'Edited ',
      ),
      `${name}: typing before loading`,
    );
    await page.evaluate(() => window.editorDiagnostics.resume());
    await page.waitForFunction(() => window.editorDiagnostics.probe([]).complete, null, {
      timeout: 90000,
    });
    await settle();
    assert.ok(
      (await page.evaluate(() => window.editorDiagnostics.probe([3]).nodes[0].text)).startsWith(
        'Edited ',
      ),
    );
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await settle();
    assert.deepEqual(
      await page.evaluate(() => window.editorDiagnostics.probe([3]).nodes[0]),
      first,
    );

    const fidelity = await page.evaluate((htmlValue) => {
      const template = document.createElement('template');
      template.innerHTML = htmlValue;

      for (const br of template.content.querySelectorAll('br'))
        br.replaceWith(document.createTextNode('\n'));
      const normal = (text) => text.replace(/\s+/g, ' ').trim();

      const expected = [...template.content.querySelectorAll('p,h1,h2,h3,h4,h5,h6')].map((e) =>
        normal(e.textContent),
      );

      const nodes = window.editorDiagnostics.read().nodes;

      const paragraphs = nodes.flatMap((n) =>
        n.kind === 'paragraph' || n.kind === 'heading'
          ? [n]
          : n.kind === 'table'
            ? n.rows.flatMap((row) => row.flatMap((cell) => cell.paragraphs))
            : [],
      );

      const mismatches = expected.flatMap((text, i) =>
        text === normal(paragraphs[i]?.text ?? '') ? [] : [i],
      );

      const underlineText = paragraphs
        .flatMap((n) =>
          n.marks.filter((s) => s.mark.type === 'underline').map((s) => n.text.slice(s.from, s.to)),
        )
        .join('');

      const expectedUnderline = [...template.content.querySelectorAll('u')]
        .map((e) => e.textContent)
        .join('');

      return {
        count: nodes.length,
        textBlocks: paragraphs.length,
        expected: expected.length,
        mismatches,
        underline: underlineText.replace(/\s/g, '') === expectedUnderline.replace(/\s/g, ''),
        last: nodes.at(-1).id,
        lastText: expected.at(-1),
      };
    }, html);

    assert.deepEqual(fidelity.mismatches, []);
    assert.equal(fidelity.textBlocks, fidelity.expected);
    assert.equal(fidelity.textBlocks, manifest.blocks);
    assert.equal(fidelity.underline, true);
    await page.screenshot({ path: `artifacts/warbreaker-${name}.png` });
    await page.evaluate((id) => window.editorDiagnostics.scrollTo(id), fidelity.last);
    await settle();
    const last = await page.evaluate((id) => window.editorDiagnostics.probe([id]), fidelity.last);
    assert.ok(last.scroll > 0);
    assert.ok(last.scene[0].y < last.scroll + 520);
    assert.equal(last.nodes[0].text.replace(/\s+/g, ' ').trim(), fidelity.lastText);
    await page.setViewportSize({ width: 420, height: 950 });
    await page.getByLabel('Zoom').selectOption('1.5');
    await page.waitForFunction(() => window.editorDiagnostics.probe([]).reflowPending === 0, null, {
      timeout: 90000,
    });
    await settle();
    const metrics = await page.evaluate(() => window.editorDiagnostics.metrics());
    assert.equal(metrics.stalePaints, 0);
    await page.screenshot({ path: `artifacts/warbreaker-${name}-narrow.png` });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.getByLabel('Sample').selectOption('extensions');
    await page.waitForURL((u) => !u.searchParams.has('sample'));
    await page.getByRole('heading', { name: 'Launch notes' }).waitFor();
    assert.equal(await page.getByLabel('Sample').inputValue(), 'extensions');
    assert.deepEqual(errors, []);
    results.push({
      browser: name,
      blocks: fidelity.count,
      textBlocks: fidelity.textBlocks,
      underlineVerified: true,
      loadMs: Math.round(metrics.completedAt - metrics.startedAt),
      stalePaints: metrics.stalePaints,
    });
    console.log(results.at(-1));
    await page.close();
  } finally {
    await browser.close();
  }
}

await writeFile(
  'artifacts/editor-book-checks.json',
  JSON.stringify({ sourceSha256: manifest.sourceSha256, results }, null, 2) + '\n',
);
