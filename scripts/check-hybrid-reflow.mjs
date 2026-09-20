import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const url=process.env.HYBRID_URL??'http://127.0.0.1:5176/hybrid-editor.html';
const results=[];
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{for(const total of [2000,10000]){
  const page=await browser.newPage({viewport:{width:1100,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const probe=(ids=[])=>page.evaluate(ids=>window.hybridSpike.probe(ids),ids);
  const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const done=()=>page.waitForFunction(()=>window.hybridSpike.probe([]).reflowPending===0);
  await page.goto(`${url}?stream=${total}`);await page.waitForFunction(()=>window.hybridSpike?.probe([]).complete);await done();
  const middle=Math.floor(total/2)+7;await page.evaluate(id=>window.hybridSpike.scrollTo(id,8),middle);await settle();
  const before=await probe([middle]);await page.setViewportSize({width:420,height:950});await settle();
  const first=await probe([middle]);assert.ok(first.reflowPending>0,'Resize completed synchronously');assert.equal(first.stats.shapeCalls,before.stats.shapeCalls);
  const screen=s=>s.scene[0].y*s.zoom-s.scroll;assert.ok(Math.abs(screen(first)-screen(before))<1.1,'First viewport moved');
  await done();await settle();const after=await probe([middle]);assert.ok(Math.abs(screen(after)-screen(before))<1.1,'Background reflow moved anchor');assert.equal(after.stats.shapeCalls,before.stats.shapeCalls);
  const reference=await page.evaluate(()=>window.hybridSpike.verifyReflow());assert.equal(reference.blocks,total);
  // Change direction before the old generation finishes, then jump to an unreflowed region and edit it.
  await page.setViewportSize({width:700,height:950});await settle();assert.ok((await probe()).reflowPending>0);
  await page.setViewportSize({width:420,height:950});await done();await settle();
  const reversal=await page.evaluate(()=>window.hybridSpike.metrics().reflows.at(-1));assert.ok(reversal.batches.reduce((n,b)=>n+b.layouts,0)<total/2,'Return to a cached width redid the entire document');
  await page.setViewportSize({width:520,height:950});await settle();
  const editId=total-9;await page.evaluate(id=>{window.hybridSpike.scrollTo(id);window.hybridSpike.select(id,0);},editId);await settle();
  const editBefore=await probe([editId]);assert.equal(editBefore.scene[0].layoutWidth,editBefore.width);assert.ok(editBefore.reflowPending>0);
  await page.keyboard.insertText('Reflow edit ');await settle();assert.ok((await probe([editId])).nodes[0].text.startsWith('Reflow edit '));
  await page.getByLabel('Zoom').selectOption('1.25');await settle();
  await done();await settle();const edited=await probe([editId]);assert.ok(edited.nodes[0].text.startsWith('Reflow edit '));assert.equal(edited.stalePaints,0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.equal((await probe([editId])).nodes[0].text,editBefore.nodes[0].text);
  // DOM measurement and focused-widget pinning during a fresh width generation.
  await page.evaluate(()=>window.hybridSpike.scrollTo(3));await settle();const block=page.locator('[data-widget="3"]');await block.getByRole('button').click();await block.getByLabel('Block notes').fill('Keep focus during reflow.');await settle();
  await page.setViewportSize({width:760,height:950});await settle();assert.ok((await probe()).reflowPending>0);
  await block.getByLabel('Block notes').evaluate(el=>{el.style.height='210px';});await settle();
  await page.evaluate(()=>window.hybridSpike.scrollTo(4,8));await settle();const anchored=await probe([4]);await done();await settle();const final=await probe([4]);
  assert.ok(Math.abs(screen(final)-screen(anchored))<1.5);assert.equal(await block.getByLabel('Block notes').evaluate(el=>el===document.activeElement),true);assert.equal(final.stalePaints,0);
  const finalReference=await page.evaluate(()=>window.hybridSpike.verifyReflow());assert.equal(finalReference.blocks,total);
  assert.deepEqual(errors,[]);const m=await page.evaluate(()=>window.hybridSpike.metrics());results.push({browser:name,total,reference,finalReference,runs:m.reflows.filter(r=>r.blocks===total),stalePaints:m.stalePaints});
  await writeFile('artifacts/hybrid-reflow-checks.json',JSON.stringify(results,null,2)+'\n');console.log(name,total,'passed');await page.close();
 }
  const page=await browser.newPage({viewport:{width:1100,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${url}?stream=10000&paused=1`);await page.waitForFunction(()=>window.hybridSpike);await page.evaluate(()=>window.hybridSpike.resume());
  await page.waitForFunction(()=>window.hybridSpike.probe([]).count>1000);await page.evaluate(()=>window.hybridSpike.pause());await page.waitForTimeout(50);
  await page.setViewportSize({width:700,height:950});await page.waitForFunction(()=>window.hybridSpike.probe([]).reflowPending>0);
  await page.evaluate(()=>{window.hybridSpike.resume();window.hybridSpike.select(1,0);});await page.keyboard.insertText('Concurrent ');
  await page.waitForFunction(()=>{const p=window.hybridSpike.probe([]);return p.complete&&!p.reflowPending;});
  const final=await page.evaluate(()=>window.hybridSpike.probe([1]));assert.equal(final.count,10000);assert.equal(final.stalePaints,0);assert.ok(final.nodes[0].text.startsWith('Concurrent '));
  const reference=await page.evaluate(()=>window.hybridSpike.verifyReflow());assert.deepEqual(errors,[]);results.push({browser:name,total:10000,streaming:true,reference,stalePaints:final.stalePaints});
  await writeFile('artifacts/hybrid-reflow-checks.json',JSON.stringify(results,null,2)+'\n');console.log(name,'concurrent stream passed');await page.close();
 }finally{await browser.close();}
}
