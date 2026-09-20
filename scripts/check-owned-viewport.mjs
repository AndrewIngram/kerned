import {chromium,firefox,webkit} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import os from 'node:os';
const results={recordedAt:new Date().toISOString(),cpu:os.cpus()[0]?.model,browsers:{}};
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.OWNED_URL??'http://127.0.0.1:5175/owned-layout.html');
  await page.waitForFunction(()=>window.ownedSpike?.checkViewport);
  const result=await page.evaluate(()=>window.ownedSpike.checkViewport());
  results.browsers[name]={version:browser.version(),...result,errors};
  await writeFile('artifacts/owned-viewport.json',JSON.stringify(results,null,2)+'\n');
  if(errors.length||Object.values(result.checks).some(v=>!v))throw new Error(JSON.stringify(result.checks));
  console.log(name,JSON.stringify(result.checks),result.drawSamples.map(s=>s.submitted));
 }finally{await browser.close();}
}
