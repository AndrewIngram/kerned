import {chromium, firefox, webkit} from 'playwright';
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import ts from 'typescript';

const report = [];
for (const name of (process.env.BROWSERS ?? 'chromium').split(',')) {
  const browser = await {chromium, firefox, webkit}[name].launch();
  try {
    for (let trial = 0; trial < Number(process.env.TRIALS ?? 1); trial++) {
      const page = await browser.newPage({viewport: {width: 1100, height: 850}});
      // Keep concurrent development/builds from reloading a measured page.
      await page.routeWebSocket(url=>url.pathname==='/',()=>{});
      if (process.env.BASELINE_DIR) {
        for (const path of ['editor/transactions.ts', 'hybrid-scene.ts']) {
          const source = await readFile(`${process.env.BASELINE_DIR}/${path}`, 'utf8');
          const {outputText} = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
          const body = outputText.replace(/from (["'])(\.[^"']+)\1/g, (_,quote,specifier)=>`from ${quote}${specifier}.ts${quote}`);
          await page.route(`**/src/${path}*`, route=>route.fulfill({contentType:'application/javascript',body}));
        }
      }
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(process.env.FORMATTING_URL ?? 'http://127.0.0.1:5173/editor.html?sample=warbreaker');
      await page.waitForFunction(() => window.hybridSpike?.probe([]).complete, undefined, {timeout: 120000});
      await page.evaluate(() => window.hybridSpike.select(window.hybridSpike.read().nodes[0].id, 0));
      await page.keyboard.press('Meta+a');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      let cdp;
      if (process.env.PROFILE && name === 'chromium') {
        cdp = await page.context().newCDPSession(page);
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.start');
      }
      const result = await page.evaluate(async () => {
        const api = window.hybridSpike;
        const original = api.read();
        const before = api.metrics();
        const start = performance.now();
        window.formattingStarted = start;
        window.formattingFrames = {active:true,last:start,gaps:[]};
        const frame = now => {
          const frames = window.formattingFrames;
          frames.gaps.push(now-frames.last); frames.last=now;
          if(frames.active)requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        document.querySelector('button[aria-label="Bold"]').click();
        const handlerMs = performance.now() - start;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const paintedMs = performance.now() - start;
        const after = api.metrics();
        const state = api.read();
        const paragraphs = state.nodes.filter(node => node.kind === 'paragraph' && node.text.length);
        const bold = paragraphs.every(node => {
          let end = 0;
          for (const span of node.spans) {
            if (span.start !== end || !span.bold) return false;
            end = span.end;
          }
          return end === node.text.length;
        });
        window.formattingOriginal = original;
        return {blocks: state.nodes.length,characters: paragraphs.reduce((n,p) => n+p.text.length,0),handlerMs,paintedMs,
          layouts: after.layoutCalls-before.layoutCalls,pending: api.probe([]).reflowPending,bold,
          selectionPreserved: JSON.stringify(state.selection) === JSON.stringify(original.selection)};
      });
      if (cdp) {
        const {profile} = await cdp.send('Profiler.stop');
        await writeFile(process.env.PROFILE, JSON.stringify(profile));
      }
      console.log(name, trial, JSON.stringify(result));
      assert.equal(result.bold, true, 'Every character must be bold');
      assert.equal(result.selectionPreserved, true);
      await page.waitForFunction(() => window.hybridSpike.probe([]).reflowPending === 0, undefined, {timeout: 120000});
      Object.assign(result, await page.evaluate(() => {
        window.formattingFrames.active=false;
        return {completeMs:performance.now()-window.formattingStarted,maxFrameGapMs:Math.max(...window.formattingFrames.gaps),stalePaints:window.hybridSpike.metrics().stalePaints};
      }));
      const undo = await page.evaluate(async () => {
        const start = performance.now();
        document.querySelector('button[aria-label="Undo"]').click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const paintedMs = performance.now() - start;
        return {paintedMs, restored: JSON.stringify(window.hybridSpike.read().nodes) === JSON.stringify(window.formattingOriginal.nodes)};
      });
      assert.equal(undo.restored, true, 'One undo must restore all original formatting');
      assert.equal(result.stalePaints, 0, 'Visible paragraphs must always have current layout');
      assert.deepEqual(errors, []);
      report.push({browser:name,trial,...result,undo});
      await writeFile(process.env.REPORT ?? 'artifacts/editor-formatting-benchmark.json', JSON.stringify(report, null, 2)+'\n');
      await page.close();
      assert.ok(result.paintedMs < Number(process.env.MAX_PAINT_MS ?? 250), `Bold took ${result.paintedMs.toFixed(1)}ms; budget is ${process.env.MAX_PAINT_MS ?? 250}ms`);
    }
  } finally {
    await browser.close();
  }
}
