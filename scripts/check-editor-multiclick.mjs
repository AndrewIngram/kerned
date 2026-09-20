import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{for(const width of [1100,390]){
  const page=await browser.newPage({viewport:{width,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/editor.html');await page.waitForFunction(()=>window.hybridSpike);
  const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await settle();
  const read=()=>page.evaluate(()=>window.hybridSpike.read());
  const point=async(id,x)=>{const s=await read(),p=s.scene.find(p=>p.id===id),b=await page.getByLabel('Canvas document').boundingBox();return {x:b.x+28+x,y:b.y+p.y-s.scroll+12};};
  const selected=async()=>{const s=await read(),n=s.nodes.find(n=>n.id===s.selection.id);return n.text.slice(Math.min(s.selection.anchor,s.selection.focus),Math.max(s.selection.anchor,s.selection.focus));};
  const first=await point(1,18);
  await page.mouse.dblclick(first.x,first.y);await settle();assert.equal(await selected(),'Good');
  await page.mouse.down({clickCount:3});await settle();assert.equal(await selected(),(await read()).nodes[0].text,'third press must expand selection without a collapsed frame');await page.mouse.up({clickCount:3});
  await page.mouse.dblclick(first.x,first.y);await settle();
  await page.keyboard.type('Great');await settle();assert.ok((await read()).nodes[0].text.startsWith('Great ideas'),JSON.stringify({text:(await read()).nodes[0].text,status:await page.getByRole('status').allTextContents()}));
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.equal(await selected(),'Good');
  const second=await point(2,18);
  await page.mouse.click(second.x,second.y,{clickCount:3});await settle();assert.equal(await selected(),(await read()).nodes[1].text);
  await page.getByRole('button',{name:'Bold',exact:true}).click();await settle();assert.equal((await read()).nodes[1].marks[0].from,0);
  await page.mouse.click(first.x,first.y);await settle();const s=await read();assert.equal(s.selection.anchor,s.selection.focus);
  for(const shortcut of ['Meta+a','Control+a']){await page.keyboard.press(shortcut);await settle();const all=await read();assert.equal(all.selection.anchorId,1);assert.equal(all.selection.anchor,0);assert.equal(all.selection.id,4);assert.equal(all.selection.focus,all.nodes[3].text.length);}
  await page.keyboard.type('Replacement');await settle();assert.equal((await read()).nodes.length,1);assert.equal((await read()).nodes[0].text,'Replacement');await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.equal((await read()).nodes.length,4);
  // A highlight remains text, including when clicking repeatedly within it.
  await page.goto('http://127.0.0.1:5173/hybrid-editor.html');await page.waitForFunction(()=>window.hybridSpike);await settle();
  await page.getByLabel('Open comment on highlighted text').first().dblclick();await settle();assert.ok((await selected()).length>0);
  const p=await point(2,20);await page.mouse.click(p.x,p.y,{clickCount:3});await settle();assert.equal(await selected(),(await read()).nodes[1].text);
  assert.deepEqual(errors,[]);console.log(name,width,'word/paragraph selection, replacement, undo, formatting and highlight clicks passed');await page.close();
 }}finally{await browser.close();}
}
