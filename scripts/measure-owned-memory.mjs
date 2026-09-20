import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
const shaping = process.env.OWNED_VARIANT === 'shaping';
const variants = shaping ? ['carets', 'shaping'] : ['objects', 'carets'];
const artifact = shaping ? 'artifacts/owned-shaping-memory.json' : 'artifacts/owned-retained-memory.json';
const browser = await chromium.launch();
const report = { recordedAt: new Date().toISOString(), cpu: os.cpus()[0]?.model, version: browser.version(), trials: [] };
await mkdir('artifacts', { recursive: true });
try {
  for (const paragraphs of [500, 2000]) for (let trial = 0; trial < 3; trial++) {
    for (const storage of trial % 2 ? [...variants].reverse() : variants) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(process.env.OWNED_URL ?? 'http://127.0.0.1:5175/owned-layout.html');
        await page.waitForFunction(() => window.prepareOwnedMemory);
        await page.evaluate(({storage,paragraphs}) => window.prepareOwnedMemory(storage,paragraphs), {storage,paragraphs});
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('HeapProfiler.enable');
        async function capture(stage, state) {
          // Allow the evaluated stack to unwind before forcing collection.
          await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
          await cdp.send('HeapProfiler.collectGarbage');
          await cdp.send('HeapProfiler.collectGarbage');
          return { stage, state, heap: await cdp.send('Runtime.getHeapUsage') };
        }
        const stages = [await capture('baseline', await page.evaluate(() => window.ownedMemory.state()))];
        for (const stage of ['loaded','wide','narrow','restore','pin-and-resize','edit-50','release-cache','drop-snapshots','release-cycles']) {
          stages.push(await capture(stage, await page.evaluate(stage => window.ownedMemory.step(stage), stage)));
        }
        if(errors.length) throw new Error(errors.join('\n'));
        const record = {paragraphs,trial,storage,stages,errors};
        for(const row of stages) {
          const m=row.state.memory;
          if(m.caretUsedBytes+m.caretUnusedBytes!==m.caretBufferBytes) throw new Error('Capacity accounting mismatch');
          if(['baseline','release-cache','drop-snapshots','release-cycles'].includes(row.stage) && row.state.retention.documents!==0) throw new Error('Cache was not released');
        }
        if (shaping) {
          const before = stages.find(s => s.stage === 'edit-50');
          const released = stages.find(s => s.stage === 'release-cache');
          const baseline = stages[0].heap;
          if (storage === 'shaping') {
            const freed = before.heap.backingStorageSize - released.heap.backingStorageSize;
            // Snapshots may retain glyph IDs, but not widths, stops or shaping positions.
            if (freed < before.state.memory.shapingBufferBytes * 0.9) throw new Error('Snapshots retain packed shaping buffers');
          } else if (before.heap.usedSize - released.heap.usedSize < (before.heap.usedSize - baseline.usedSize) * 0.4) {
            throw new Error('Snapshots retain the shaping object graph');
          }
        }
        report.trials.push(record);
        await writeFile(artifact,JSON.stringify(report,null,2)+'\n');
        const baseline=stages[0].heap;
        console.log(paragraphs,storage,trial,stages.filter(s=>['loaded','drop-snapshots','release-cycles'].includes(s.stage)).map(s=>`${s.stage}: JS ${((s.heap.usedSize-baseline.usedSize)/1e6).toFixed(2)} MB, backing ${((s.heap.backingStorageSize-baseline.backingStorageSize)/1e6).toFixed(2)} MB`).join(' | '));
      } finally {await page.close();}
    }
  }
} finally {await browser.close();}
