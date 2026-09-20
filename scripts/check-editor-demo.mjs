import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{for(const width of [1100,390]){
  const page=await browser.newPage({viewport:{width,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/editor.html');await page.waitForFunction(()=>window.hybridSpike);
  const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await settle();
  const read=()=>page.evaluate(()=>window.hybridSpike.read());
  const original=(await read()).nodes;
  assert.equal(await page.getByRole('button',{name:'Bold',exact:true}).isDisabled(),true);
  await page.evaluate(()=>window.hybridSpike.select(1,0));
  await page.keyboard.down('Shift');for(let i=0;i<10;i++)await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift');await settle();
  const before=(await read()).selection;
  await page.getByRole('button',{name:'Bold',exact:true}).click();await settle();
  let s=await read();assert.ok(s.nodes[0].spans.some(s=>s.bold&&s.start===0&&s.end===before.focus));assert.deepEqual(s.selection,before);
  await page.getByRole('button',{name:'Italic',exact:true}).click();await settle();assert.ok((await read()).nodes[0].spans.some(s=>s.bold&&s.italic));
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.ok((await read()).nodes[0].spans.every(s=>!s.italic));
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.deepEqual((await read()).nodes,original);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await settle();assert.ok((await read()).nodes[0].spans.some(s=>s.bold));
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();
  const canvas=page.getByLabel('Canvas document'),box=await canvas.boundingBox(),state=await read();
  const first=state.scene[0],second=state.scene[1];
  await page.mouse.move(box.x+65,box.y+first.y+12);await page.mouse.down();await page.mouse.move(box.x+100,box.y+second.y+12,{steps:12});await page.mouse.up();await settle();
  assert.equal((await read()).selection.id,2);
  await page.getByRole('button',{name:'Bold',exact:true}).click();await settle();s=await read();assert.ok(s.nodes[0].spans.length>0);assert.ok(s.nodes[1].spans.some(s=>s.start===0&&s.bold));
  await page.keyboard.type('A new thought');await settle();assert.equal((await read()).nodes.length,3);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.equal((await read()).nodes.length,4);
  await page.evaluate(()=>window.hybridSpike.select(1,0));await page.keyboard.insertText('é');await settle();assert.ok((await read()).nodes[0].text.startsWith('é'));await page.keyboard.insertText('漢');await page.getByRole('status').filter({hasText:'Latin'}).waitFor();
  assert.ok(!(await read()).nodes[0].text.includes('漢'));
  await page.screenshot({path:`artifacts/editor-demo-${name}-${width}.png`});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);console.log(name,width,'formatting, undo, redo, cross-paragraph edits, validation and layout passed');await page.close();
 }}finally{await browser.close();}
}
