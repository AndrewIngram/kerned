import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';

// Run serially: other browser benchmarks would contaminate the measurements.
const trials = Number(process.env.TRIALS ?? 3);

assert.ok(Number.isSafeInteger(trials) && trials >= 3, 'At least three trials are required');

const directory = process.env.REPORT_DIR ?? 'artifacts/editor-foundation';

await mkdir(directory, {recursive: true});

const report = {
  recordedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  environment: {cpu: os.cpus()[0]?.model, platform: os.platform(), arch: os.arch(), node: process.version,
    mode: 'Vite development server; fresh browser/context per phase; OS/server caches not cleared',
    viewport: {width: 1100, height: 900}, sample: 'warbreaker'},
  methodology: {
    input: 'Browser beforeinput to second requestAnimationFrame, including frame scheduling, one key at a time',
    navigation: 'Browser keydown to second requestAnimationFrame for alternating PageDown/PageUp',
    memory: 'Chromium JS heap and backing storage after forced GC, separate from timed interactions; excludes total process/GPU memory',
    loading: 'Existing streaming benchmark with find off',
    paste: 'Existing synthetic rich-clipboard benchmark, including duplicate-content and undo/redo assertions',
  },
  trials: [],
};

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  assert.ok(sorted.length > 0 && sorted.every(Number.isFinite));

  return {min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1)};
}

async function existing(script, filename, environment) {
  execFileSync(process.execPath, [script], {env: {...process.env, ...environment, REPORT: filename}, stdio: 'inherit'});

  return JSON.parse(await readFile(filename, 'utf8'))[0];
}

for (let trial = 0; trial < trials; trial++) {
  const loading = await existing('scripts/benchmark-editor-loading.mjs', `${directory}/loading-${trial}.json`, {BROWSERS: 'chromium', SAMPLES: 'warbreaker', FIND: 'off'});
  const paste = await existing('scripts/benchmark-editor-paste.mjs', `${directory}/paste-${trial}.json`, {BROWSERS: 'chromium'});
  const browser = await chromium.launch();

  try {
    report.environment.browser = browser.version();
    const page = await browser.newPage({viewport: report.environment.viewport}), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.routeWebSocket(url => url.pathname === '/', () => {});
    await page.goto('http://127.0.0.1:5173/editor.html?sample=warbreaker');
    await page.waitForFunction(() => window.editorDiagnostics?.probe([]).complete, null, {timeout: 120000});
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.enable');

    async function heap() {
      await cdp.send('HeapProfiler.collectGarbage');

      return cdp.send('Runtime.getHeapUsage');
    }

    const loadedHeap = await heap();
    await page.evaluate(() => window.editorDiagnostics.select(1, 0));
    const original = await page.evaluate(() => window.editorDiagnostics.read().nodes[0].text);

    async function measuredKey(key, eventType) {
      await page.evaluate(eventType => {
        window.foundationFrame = null;
        document.addEventListener(eventType, () => {
          const started = performance.now();
          requestAnimationFrame(() => requestAnimationFrame(() => { window.foundationFrame = performance.now() - started; }));
        }, {capture: true, once: true});
      }, eventType);
      await page.keyboard.press(key);
      await page.waitForFunction(() => window.foundationFrame !== null);

      return page.evaluate(() => window.foundationFrame);
    }

    const typing = [];

    for (let i = 0; i < 12; i++) typing.push(await measuredKey('x', 'beforeinput'));
    assert.equal(await page.evaluate(() => window.editorDiagnostics.read().nodes[0].text), 'x'.repeat(12) + original);
    const paging = [];

    for (let i = 0; i < 12; i++) paging.push(await measuredKey(i % 2 ? 'PageUp' : 'PageDown', 'keydown'));
    const afterInteractionHeap = await heap();
    assert.deepEqual(errors, []);

    const row = {trial, loading, paste, typingMs: distribution(typing), typingSamplesMs: typing,
      pagingMs: distribution(paging), pagingSamplesMs: paging, loadedHeap, afterInteractionHeap};

    report.trials.push(row);
    await writeFile(`${directory}/baseline.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(`Foundation trial ${trial + 1}/${trials}: typing ${row.typingMs.median.toFixed(1)} ms, paging ${row.pagingMs.median.toFixed(1)} ms`);
  } finally { await browser.close(); }
}

report.summary = Object.fromEntries([
  ['firstUsableMs', r => r.loading.firstUsableMs], ['streamingMs', r => r.loading.loadMs],
  ['pasteHandlerMs', r => r.paste.handlerMs], ['pastePaintMs', r => r.paste.paintMs],
  ['typingFrameMs', r => r.typingMs.median], ['pagingFrameMs', r => r.pagingMs.median],
  ['loadedHeapBytes', r => r.loadedHeap.usedSize],
].map(([name, select]) => [name, distribution(report.trials.map(select))]));

await writeFile(`${directory}/baseline.json`, JSON.stringify(report, null, 2) + '\n');

console.log(JSON.stringify(report.summary, null, 2));
