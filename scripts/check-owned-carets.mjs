import { chromium, firefox, webkit } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const output = { recordedAt: new Date().toISOString(), browsers: {} };
for (const [name, type] of Object.entries({chromium,firefox,webkit})) {
  const browser = await type.launch();
  try {
    const page = await browser.newPage();const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.OWNED_URL ?? 'http://127.0.0.1:5175/owned-layout.html');
    await page.waitForFunction(()=>window.ownedSpike);
    const validation=await page.evaluate(()=>window.ownedSpike.validateCarets());
    const queries=await page.evaluate(()=>window.ownedSpike.benchmarkCaretQueries());
    output.browsers[name]={version:browser.version(),validation,queries,errors};
    await writeFile('artifacts/owned-caret-checks.json',JSON.stringify(output,null,2)+'\n');
    console.log(name,validation.assertions,'assertions',validation.failures);
    for(const row of queries.results) console.log(name,row.kind,row.operation,row.variants.map(v=>`${v.name} ${v.medianBatchMs.toFixed(2)}ms`).join(' | '));
    if(errors.length || validation.failures.length || queries.results.some(r=>!r.equivalent)) process.exitCode=1;
  } finally {await browser.close();}
}
