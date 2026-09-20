import {chromium,firefox,webkit} from 'playwright';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import os from 'node:os';
const base=process.env.HYBRID_URL??'http://127.0.0.1:5176/hybrid-editor.html';
const report={recordedAt:new Date().toISOString(),cpu:os.cpus()[0]?.model,trials:[],memory:[]};
function distribution(values){const a=[...values].sort((a,b)=>a-b);return{median:a[Math.floor(a.length*.5)]??0,p95:a[Math.min(a.length-1,Math.floor(a.length*.95))]??0,max:a.at(-1)??0};}
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{for(const total of [2000,10000])for(let trial=0;trial<3;trial++){
  const page=await browser.newPage({viewport:{width:1100,height:950},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}?stream=${total}`);
  await page.waitForFunction(()=>window.hybridSpike?.probe([]).complete,undefined,{timeout:120000});
  const m=await page.evaluate(()=>window.hybridSpike.metrics());assert.deepEqual(errors,[]);
  const frames=m.frames.filter(f=>f.at>=m.firstCanvasFlushMs&&f.at<=m.completedAt).map(f=>f.gapMs);
  const row={browser:name,version:browser.version(),total,trial,firstCanvasFlushMs:m.firstCanvasFlushMs,firstLoaded:m.firstLoaded,completeFromNavigationMs:m.completedAt,loadAfterMountMs:m.completedAt-m.startedAt,batches:m.samples.length,chunkWorkMs:distribution(m.samples.map(s=>s.workMs)),chunkElapsedMs:distribution(m.samples.map(s=>s.elapsedMs)),frameGapMs:distribution(frames),framesOver32Ms:frames.filter(v=>v>32).length,canvasDrawMs:distribution(m.paints),maxMounted:m.maxMounted,maxSubmitted:m.maxSubmitted,layoutCalls:m.layoutCalls,memory:m.memory};
  assert.equal(row.firstLoaded,32);assert.ok(row.maxMounted<10&&row.maxSubmitted<25);
  report.trials.push(row);await writeFile('artifacts/hybrid-large-benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(name,total,trial,Math.round(row.firstCanvasFlushMs),Math.round(row.loadAfterMountMs),row.frameGapMs.max.toFixed(1));await page.close();
 }}finally{await browser.close();}
}
// Retention is measured separately so forced GC cannot distort loading timings.
const browser=await chromium.launch();
try{for(const total of [2000,10000]){
 const page=await browser.newPage({viewport:{width:1100,height:950}});
 await page.goto(`${base}?stream=${total}&paused=1`);await page.waitForFunction(()=>window.hybridSpike);
 const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.enable');
 async function heap(){await cdp.send('HeapProfiler.collectGarbage');await cdp.send('HeapProfiler.collectGarbage');return await cdp.send('Runtime.getHeapUsage');}
 const baseline=await heap();await page.evaluate(()=>window.hybridSpike.resume());await page.waitForFunction(()=>window.hybridSpike.probe([]).complete,undefined,{timeout:120000});
 const loaded=await heap(),metrics=await page.evaluate(()=>window.hybridSpike.metrics());
 report.memory.push({total,baselineBlocks:32,baseline,loaded,delta:{usedSize:loaded.usedSize-baseline.usedSize,backingStorageSize:loaded.backingStorageSize-baseline.backingStorageSize},buffers:metrics.memory});
 await writeFile('artifacts/hybrid-large-benchmark.json',JSON.stringify(report,null,2)+'\n');await page.close();
}}finally{await browser.close();}
