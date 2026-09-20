import {chromium, firefox, webkit} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const results = [];
for (const name of (process.env.BROWSERS??'chromium,firefox,webkit').split(',')) {
  const type={chromium,firefox,webkit}[name];
  const browser = await type.launch();
  try {
    const page = await browser.newPage({viewport:{width:1100,height:850}}), errors=[];
    // The application needs no socket; suppress the dev server's hot reload.
    await page.routeWebSocket(url=>url.pathname==='/',()=>{});
    page.on('pageerror', error=>errors.push(error.message));
    // The diagnostic editor exposes an independent eager-layout oracle.
    await page.goto('http://127.0.0.1:5173/hybrid-editor.html?sample=warbreaker');
    await page.waitForFunction(()=>window.hybridSpike?.probe([]).complete, undefined, {timeout:120000});
    const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const done=()=>page.waitForFunction(()=>window.hybridSpike.probe([]).reflowPending===0, undefined, {timeout:120000});
    const pending=()=>page.evaluate(()=>window.hybridSpike.probe([]).reflowPending);
    const click=async name=>{
      if(name==='Bold'||name==='Italic')await page.keyboard.press(name==='Bold'?'Meta+b':'Meta+i');
      else await page.getByRole('button',{name,exact:true}).click();
      await settle();
    };
    const original=await page.evaluate(()=>window.hybridSpike.read().nodes);
    await page.evaluate(()=>window.hybridSpike.select(1,0));await page.keyboard.press('Meta+a');await settle();
    await click('Bold');assert.ok(await pending()>1000,'Formatting must defer offscreen layout');
    const firstPaint=await page.getByLabel('Canvas document').screenshot();
    await done();await settle();
    assert.ok(firstPaint.equals(await page.getByLabel('Canvas document').screenshot()), 'Visible bold pixels must match completed layout');
    const boldReference=await page.evaluate(()=>window.hybridSpike.verifyReflow());
    await click('Undo');await done();
    assert.deepEqual(await page.evaluate(()=>window.hybridSpike.read().nodes),original);
    // Undo while most pending paragraphs still contain their original layout.
    await click('Bold');assert.ok(await pending()>1000);
    await click('Undo');await done();
    assert.deepEqual(await page.evaluate(()=>window.hybridSpike.read().nodes),original);
    const undoReference=await page.evaluate(()=>window.hybridSpike.verifyReflow());
    // Replace pending bold with bold+italic, then undo/redo before completion.
    await click('Bold');await click('Italic');assert.ok(await pending()>1000);
    await click('Undo');await click('Redo');
    await page.setViewportSize({width:700,height:850});await settle();
    await page.setViewportSize({width:1100,height:850});await settle();
    const middle=original[Math.floor(original.length/2)].id;
    await page.evaluate(id=>window.hybridSpike.scrollTo(id,8),middle);await settle();
    const before=await page.evaluate(id=>window.hybridSpike.probe([id]),middle);
    assert.ok(before.reflowPending>0,'Jump must promote a paragraph before background completion');
    assert.equal(before.scene[0].layoutWidth,before.width);
    const jumpPaint=await page.getByLabel('Canvas document').screenshot();
    await done();await settle();
    const after=await page.evaluate(id=>window.hybridSpike.probe([id]),middle);
    assert.ok(Math.abs((after.scene[0].y-after.scroll)-(before.scene[0].y-before.scroll))<1.1,`Background formatting must preserve scroll anchor: ${JSON.stringify({before:{scroll:before.scroll,scene:before.scene},after:{scroll:after.scroll,scene:after.scene}})}`);
    assert.ok(jumpPaint.equals(await page.getByLabel('Canvas document').screenshot()),'Promoted viewport pixels must match final layout');
    const finalReference=await page.evaluate(()=>window.hybridSpike.verifyReflow());
    const stalePaints=await page.evaluate(()=>window.hybridSpike.metrics().stalePaints);
    assert.equal(stalePaints,0);assert.deepEqual(errors,[]);
    results.push({browser:name,boldReference,undoReference,finalReference,stalePaints});
    await writeFile('artifacts/editor-formatting-reflow.json',JSON.stringify(results,null,2)+'\n');
    console.log(name,'bulk format, immediate undo/redo, superseding edits, resize, scroll anchors and eager geometry passed');
  } finally {
    await browser.close();
  }
}
