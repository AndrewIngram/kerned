import {chromium,firefox,webkit} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const results={};
for(const [name,type] of Object.entries({chromium,firefox,webkit})) {
 const browser=await type.launch();
 try {
  results[name]=[];
  for(const storage of ['carets','shaping'])for(const styled of [false,true]) {
   const page=await browser.newPage();
   try {
    await page.goto(process.env.OWNED_URL??'http://127.0.0.1:5175/owned-layout.html');
    await page.waitForFunction(()=>window.prepareOwnedLarge);
    await page.evaluate(({storage,styled})=>window.prepareOwnedLarge(storage,40,styled),{storage,styled});
    const result=await page.evaluate(()=>window.ownedLarge.fragments());
    if(Object.values(result.checks).some(v=>!v))throw new Error(JSON.stringify(result));
    results[name].push({storage,styled,...result});
    await page.evaluate(()=>window.ownedLarge.dispose());
   }finally{await page.close();}
  }
 }finally{await browser.close();}
}
await writeFile('artifacts/owned-fragment-loading.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
