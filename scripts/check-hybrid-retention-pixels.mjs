import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base=process.env.HYBRID_URL??'http://127.0.0.1:5176/hybrid-editor.html';
const browser=await chromium.launch(),results=[];
try{
 const pages=[];
 for(const retention of ['all','viewport']){
  const page=await browser.newPage({viewport:{width:1100,height:950}});
  await page.goto(`${base}?stream=10000&retention=${retention}`);
  await page.waitForFunction(()=>window.hybridSpike?.probe([]).complete);pages.push(page);
 }
 for(const id of [5011,10005,1]){
  const images=[];
  for(const [i,page] of pages.entries()){
   await page.evaluate(id=>window.hybridSpike.scrollTo(id),id);
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   images.push(await page.locator('.document-scroll').screenshot({path:`artifacts/hybrid-retention-${id}-${i}.png`}));
  }
  assert.ok(images[0].equals(images[1]),`Rendered pixels differ at ${id}`);results.push({id,identical:true,bytes:images[0].length});
 }
 await writeFile('artifacts/hybrid-retention-pixels.json',JSON.stringify(results,null,2)+'\n');console.log(results);
}finally{await browser.close();}
