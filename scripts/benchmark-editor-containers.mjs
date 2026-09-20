import {chromium,firefox,webkit} from 'playwright';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const report={recordedAt:new Date().toISOString(),cases:[]};
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.HYBRID_URL??'http://127.0.0.1:5176/hybrid-editor.html');await page.waitForFunction(()=>window.hybridSpike);
  const checks=await page.evaluate(()=>window.hybridSpike.checkContainers());
  const results=await page.evaluate(()=>window.hybridSpike.benchmarkContainerEdits());
  assert.deepEqual(errors,[]);report.cases.push({browser:name,version:browser.version(),checks,results});
  await writeFile('artifacts/editor-container-benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(name,checks,results.map(({count,nested,medianMs,p95Ms})=>({count,nested,medianMs,p95Ms})));
 }finally{await browser.close();}
}
