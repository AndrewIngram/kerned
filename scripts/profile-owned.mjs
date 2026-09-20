import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
const carets = process.env.OWNED_VARIANT === 'carets';
const folder = carets ? 'artifacts/owned-caret-profiles' : 'artifacts/owned-profiles';
const artifact = carets ? 'artifacts/owned-caret-profiling.json' : 'artifacts/owned-profiling.json';
await mkdir(folder, { recursive: true });
const browser = await chromium.launch();
const report = { recordedAt: new Date().toISOString(), cpu: os.cpus()[0]?.model, version: browser.version(), runs: [] };
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.OWNED_URL ?? 'http://127.0.0.1:5173/owned-layout.html');
  await page.waitForFunction(() => window.prepareOwnedProfile);
  await page.evaluate(carets => window.prepareOwnedProfile(carets ? 'carets' : 'packed'), carets);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Debugger.enable');
  await cdp.send('Profiler.enable');
  await cdp.send('HeapProfiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  for (const scenario of ['cold', 'resize', 'edit'].filter(s => !process.env.OWNED_PROFILE_SCENARIO || s === process.env.OWNED_PROFILE_SCENARIO)) for (const variant of [0, 1]) {
    const name = `${scenario}-${variant === 0 ? 'objects' : carets ? 'carets' : 'packed'}`;
    const iterations = scenario === 'cold' ? 100 : scenario === 'resize' ? 300 : 2000;
    await page.evaluate(({ variant, scenario }) => { window.ownedProfile.prime(); window.ownedProfile.run(variant, scenario, 20); }, { variant, scenario });
    await page.evaluate(() => window.ownedProfile.prime());
    // CPU and allocation profiles run separately: neither is a latency benchmark.
    await cdp.send('Profiler.start');
    const cpuRun = await page.evaluate(args => window.ownedProfile.run(args.variant, args.scenario, args.iterations), { variant, scenario, iterations });
    const { profile: cpu } = await cdp.send('Profiler.stop');
    const sources = {};
    for (const node of cpu.nodes) {
      const f = node.callFrame;
      if (f.url.includes('/src/owned-') && !sources[f.scriptId]) {
        sources[f.scriptId] = { url: f.url, ...(await cdp.send('Debugger.getScriptSource', { scriptId: f.scriptId })) };
      }
    }
    await page.evaluate(() => window.ownedProfile.prime());
    await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    const heapRun = await page.evaluate(args => window.ownedProfile.run(args.variant, args.scenario, args.iterations), { variant, scenario, iterations });
    const { profile: heap } = await cdp.send('HeapProfiler.stopSampling');
    const allocations = [];
    function visit(node) {
      if (node.selfSize) allocations.push({ ...node.callFrame, sampledBytes: node.selfSize });
      node.children.forEach(visit);
    }
    visit(heap.head);
    const functions = cpu.nodes.filter(n => n.hitCount).map(n => ({ ...n.callFrame, samples: n.hitCount, positionTicks: n.positionTicks }));
    const entry = { name, scenario, variant, iterations, cpuRun, heapRun, functions: functions.sort((a, b) => b.samples - a.samples), allocations: allocations.sort((a, b) => b.sampledBytes - a.sampledBytes) };
    report.runs.push(entry);
    await writeFile(`${folder}/${name}.cpuprofile`, JSON.stringify(cpu));
    await writeFile(`${folder}/${name}.heapprofile`, JSON.stringify(heap));
    await writeFile(`${folder}/${name}.sources.json`, JSON.stringify(sources));
    await writeFile(artifact, JSON.stringify(report, null, 2)+'\n');
    console.log(name, 'CPU', cpuRun.elapsedMs.toFixed(0), 'ms', 'sampled allocation MB', (allocations.reduce((n,a)=>n+a.sampledBytes,0)/1e6).toFixed(1));
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
