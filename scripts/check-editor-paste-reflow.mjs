import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const reports=[];
for(const name of (process.env.BROWSERS??'chromium,firefox,webkit').split(',')){
  const browser=await {chromium,firefox,webkit}[name].launch();
  try{
    const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.routeWebSocket(url=>url.pathname==='/',()=>{});
    await page.goto('http://127.0.0.1:5173/hybrid-editor.html?sample=warbreaker');
    await page.waitForFunction(()=>window.hybridSpike?.probe([]).complete);
    const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const done=()=>page.waitForFunction(()=>window.hybridSpike.probe([]).reflowPending===0,null,{timeout:60000});
    const original=await page.evaluate(()=>window.hybridSpike.read().nodes);
    await page.evaluate(()=>window.hybridSpike.select(1,0));await page.keyboard.press('ControlOrMeta+a');await settle();
    await page.locator('.text-capture').evaluate(el=>{
      const event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});el.dispatchEvent(event);window.pasteData=Object.fromEntries([...event.clipboardData.types].map(type=>[type,event.clipboardData.getData(type)]));
      const last=window.hybridSpike.read().nodes.at(-1);window.hybridSpike.select(last.id,last.text.length);
    });await settle();
    await page.locator('.text-capture').evaluate(el=>{
      const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});
      for(const [type,value] of Object.entries(window.pasteData))event.clipboardData.setData(type,value);
      el.dispatchEvent(event);
    });await settle();
    assert.equal(await page.locator('.input-notice').innerText(),'');
    assert.equal(await page.evaluate(()=>window.hybridSpike.read().nodes.length),original.length*2);
    assert.ok(await page.evaluate(()=>window.hybridSpike.probe([]).reflowPending)>1000,'Pasting defers offscreen paragraphs');
    await page.keyboard.press('Meta+a');await settle();
    assert.ok(await page.evaluate(()=>{
      const {nodes,selection}=window.hybridSpike.read();
      return selection.anchorId===nodes[0].id&&selection.anchor===0&&selection.id===nodes.at(-1).id&&selection.focus===nodes.at(-1).text.length;
    }),'Cmd-A selects both copies while layout is pending');
    await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();await done();
    assert.deepEqual(await page.evaluate(()=>window.hybridSpike.read().nodes),original,'Undo cancels pending insertion layout');
    await page.getByRole('button',{name:'Redo',exact:true}).click();await settle();
    assert.ok(await page.evaluate(()=>window.hybridSpike.probe([]).reflowPending)>1000);
    const last=await page.evaluate(()=>window.hybridSpike.read().nodes.at(-1));
    await page.evaluate(id=>window.hybridSpike.select(id,0),last.id);await settle();await page.keyboard.type('Pasted edit ');await settle();
    assert.equal(await page.evaluate(id=>window.hybridSpike.probe([id]).nodes[0].text,last.id),'Pasted edit '+last.text,'Queued layout must not replace a subsequent edit');
    await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();
    assert.equal(await page.evaluate(id=>window.hybridSpike.probe([id]).nodes[0].text,last.id),last.text);
    await page.setViewportSize({width:700,height:850});await settle();
    await page.setViewportSize({width:1100,height:850});await settle();
    const middle=await page.evaluate(()=>{const nodes=window.hybridSpike.read().nodes;return nodes[Math.floor(nodes.length*.75)].id;});
    await page.evaluate(id=>window.hybridSpike.scrollTo(id,8),middle);await settle();
    const before=await page.evaluate(id=>window.hybridSpike.probe([id]),middle);
    assert.ok(before.reflowPending>0,'Scrolling promotes inserted content before background completion');
    const canvas=page.getByLabel('Canvas document'),firstPaint=await canvas.screenshot();
    await done();await settle();
    const after=await page.evaluate(id=>window.hybridSpike.probe([id]),middle);
    assert.ok(Math.abs((after.scene[0].y-after.scroll)-(before.scene[0].y-before.scroll))<1.1,'Background layout preserves the reading position');
    assert.ok(firstPaint.equals(await canvas.screenshot()),'Promoted text pixels must match completed layout');
    const reference=await page.evaluate(()=>window.hybridSpike.verifyReflow());
    const stalePaints=await page.evaluate(()=>window.hybridSpike.metrics().stalePaints);
    assert.equal(stalePaints,0);assert.deepEqual(errors,[]);
    reports.push({browser:name,reference,stalePaints});console.log(JSON.stringify(reports.at(-1)));
  }finally{await browser.close();}
}
await writeFile('artifacts/editor-paste-reflow.json',JSON.stringify(reports,null,2)+'\n');
