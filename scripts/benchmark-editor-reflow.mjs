import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import os from 'node:os';
const base=process.env.EDITOR_URL??'http://127.0.0.1:5176/extensions.html';
const report={recordedAt:new Date().toISOString(),cpu:os.cpus()[0]?.model,trials:[]};
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{for(let trial=0;trial<3;trial++)for(const mode of trial%2?['eager','viewport']:['viewport','eager']){
  const page=await browser.newPage({viewport:{width:1100,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}?stream=10000&reflow=${mode}`);await page.waitForFunction(()=>window.editorDiagnostics?.probe([]).complete&&!window.editorDiagnostics.probe([]).reflowPending);
  await page.evaluate(()=>window.editorDiagnostics.scrollTo(5011,8));await page.waitForTimeout(100);
  const before=await page.evaluate(()=>window.editorDiagnostics.probe([5011]));
  await page.evaluate(()=>{window.resizeFrames=[];window.resizeSampling=true;let last=performance.now();function frame(now){window.resizeFrames.push(now-last);last=now;if(window.resizeSampling)requestAnimationFrame(frame);}requestAnimationFrame(frame);});
  await page.setViewportSize({width:700,height:950});
  await page.waitForFunction(g=>{const p=window.editorDiagnostics.probe([]);return p.generation>g&&!p.reflowPending;},before.generation);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>{window.resizeSampling=false;r();})));
  const result=await page.evaluate(()=>({run:window.editorDiagnostics.metrics().reflows.at(-1),frames:window.resizeFrames,after:window.editorDiagnostics.probe([5011])}));
  assert.equal(result.after.stalePaints,0);assert.equal(result.after.stats.shapeCalls,before.stats.shapeCalls);assert.deepEqual(errors,[]);
  assert.ok(Math.abs((result.after.scene[0].y-result.after.scroll)-(before.scene[0].y-before.scroll))<1.1);
  const row={browser:name,version:browser.version(),trial,mode,...result.run,frameMaxMs:Math.max(...result.frames),framesOver32:result.frames.filter(t=>t>32).length};
  report.trials.push(row);await writeFile(process.env.REFLOW_REPORT??'artifacts/editor-reflow-benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(name,trial,mode,'first',row.firstPaintMs.toFixed(1),'complete',row.completeMs.toFixed(1),'frame',row.frameMaxMs.toFixed(1));await page.close();
 }}finally{await browser.close();}
}
