import { chromium, firefox, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
const output = { recordedAt: new Date().toISOString(), cpu: os.cpus()[0]?.model, browsers: {} };
const artifact = 'artifacts/owned-large-documents.json';
await mkdir('artifacts', {recursive:true});
for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
 const browser = await type.launch();
 output.browsers[name] = {version:browser.version(),cases:[]};
 try {
  for (const count of [2000,10000]) for(const styled of [false,true]) {
   for(const storage of styled ? ['shaping','carets'] : ['carets','shaping']) {
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    try {
     await page.goto(process.env.OWNED_URL ?? 'http://127.0.0.1:5175/owned-layout.html');
     await page.waitForFunction(()=>window.prepareOwnedLarge);
     await page.evaluate(({storage,count,styled})=>window.prepareOwnedLarge(storage,count,styled),{storage,count,styled});
     await page.evaluate(()=>window.ownedLarge.warm());
     const cdp=name==='chromium'?await page.context().newCDPSession(page):null;
     async function capture() {
      if(!cdp)return null;
      await cdp.send('HeapProfiler.collectGarbage');await cdp.send('HeapProfiler.collectGarbage');
      return {heap:await cdp.send('Runtime.getHeapUsage'),state:await page.evaluate(()=>window.ownedLarge.state())};
     }
     const baseline=await capture(), trials=[];
     for(let trial=0;trial<3;trial++) {
      const cold=await page.evaluate(()=>window.ownedLarge.cold());
      const streamed=await page.evaluate(chunk=>window.ownedLarge.stream(chunk),count===2000?100:500);
      trials.push({cold,streamed});
      console.log(name,count,styled?'styled':'plain',storage,trial,`cold ${cold.layoutMs.toFixed(1)}ms first ${streamed.firstSubmittedMs.toFixed(1)}ms total work ${streamed.totalWorkMs.toFixed(1)}ms`);
     }
     const loaded=await capture();
     const validation=await page.evaluate(()=>window.ownedLarge.validateAndEdit());
     if(Object.values(validation.checks).some(v=>!v))throw new Error(JSON.stringify(validation.checks));
     await page.evaluate(()=>window.ownedLarge.release());
     const released=await capture();
     if(released && (released.state.retention.documents!==0||released.state.snapshot))throw new Error('Document retained after release');
     await page.evaluate(()=>window.ownedLarge.dispose());
     if(errors.length)throw new Error(errors.join('\n'));
     output.browsers[name].cases.push({count,styled,storage,trials,validation,memory:{baseline,loaded,released},errors});
     await writeFile(artifact,JSON.stringify(output,null,2)+'\n');
    } finally {await page.close();}
   }
  }
 } finally {await browser.close();}
}
