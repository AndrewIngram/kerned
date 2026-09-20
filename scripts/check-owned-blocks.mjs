import {chromium,firefox,webkit} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const results={};
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.OWNED_URL??'http://127.0.0.1:5175/owned-layout.html');
  await page.waitForFunction(()=>window.ownedSpike?.checkBlocks);
  const result=await page.evaluate(()=>window.ownedSpike.checkBlocks());
  results[name]={...result,errors};
  if(errors.length||Object.values(result.checks).some(v=>!v))throw new Error(JSON.stringify(results[name]));
  console.log(name,result.assertions,'assertions passed');
 }finally{await browser.close();}
}
await writeFile('artifacts/owned-block-checks.json',JSON.stringify(results,null,2)+'\n');
