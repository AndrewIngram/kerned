import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{
  const page=await browser.newPage({viewport:{width:1100,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.HYBRID_URL??'http://127.0.0.1:5173/hybrid-editor.html');await page.waitForFunction(()=>window.hybridSpike);
  const read=()=>page.evaluate(()=>window.hybridSpike.read());
  const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const canvas=page.getByLabel('Canvas document');
  const point=async(id,x)=>{const state=await read(),box=await canvas.boundingBox(),p=state.scene.find(p=>p.id===id);return {x:box.x+(28+x)*state.zoom,y:box.y+(p.y+15)*state.zoom-state.scroll};};
  const drag=async(from,to)=>{await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:12});await page.mouse.up();await settle();};
  const original=(await read()).nodes;
  await drag(await point(1,45),await point(2,55));
  let state=await read();assert.equal(state.selection.id,2,`${name}: drag head reaches second paragraph`);assert.equal(state.selection.anchorId,1,`${name}: drag anchor remains in first paragraph`);
  const input=page.getByLabel('Canvas text input');
  const a=state.selection.anchor,h=state.selection.focus;
  const copied=await input.evaluate(el=>{const data=new DataTransfer();const event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data});el.dispatchEvent(event);return event.clipboardData.getData('text/plain');});
  assert.ok(copied.includes('\n'));assert.ok(copied.endsWith(original[1].text.slice(0,h)));
  await canvas.screenshot({path:`artifacts/cross-selection-${name}.png`});
  await page.keyboard.type('XYZ');await settle();
  assert.equal((await read()).nodes[0].text,original[0].text.slice(0,a)+'XYZ'+original[1].text.slice(h));
  assert.ok(!(await read()).nodes.some(node=>node.id===2));
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();
  assert.deepEqual((await read()).nodes,original);assert.equal((await read()).selection.anchorId,1);assert.equal((await read()).selection.id,2);
  await page.keyboard.press('Enter');await settle();
  state=await read();assert.equal(state.nodes[0].text,original[0].text.slice(0,a));assert.equal(state.nodes[1].text,original[1].text.slice(h));
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.deepEqual((await read()).nodes,original);
  await drag(await point(2,55),await point(1,45));
  state=await read();assert.equal(state.selection.anchorId,2);assert.equal(state.selection.id,1);
  const reverseStart=state.selection.focus,reverseEnd=state.selection.anchor;
  await page.keyboard.press('Backspace');await settle();
  assert.equal((await read()).nodes[0].text,original[0].text.slice(0,reverseStart)+original[1].text.slice(reverseEnd));
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.deepEqual((await read()).nodes,original);
  // Keyboard extension and shift-click preserve the anchor across paragraphs.
  const p1=await point(1,45);await page.mouse.click(p1.x,p1.y);await page.keyboard.press('End');await settle();
  await page.keyboard.press('Shift+ArrowRight');await settle();assert.equal((await read()).selection.anchorId,1);assert.equal((await read()).selection.id,2);
  const p2=await point(2,70);await page.keyboard.down('Shift');await page.mouse.click(p2.x,p2.y);await page.keyboard.up('Shift');await settle();assert.equal((await read()).selection.anchorId,1);assert.equal((await read()).selection.id,2);
  // A selection through an embedded block shows that block as selected and deletes it atomically.
  await drag(await point(2,45),await point(4,55));await settle();
  state=await read();assert.equal(state.selection.anchorId,2);assert.equal(state.selection.id,4);
  assert.equal(await page.locator('[data-widget="3"]').evaluate(el=>el.parentElement.dataset.selected),'true');
  await page.keyboard.press('Delete');await settle();assert.ok(!(await read()).nodes.some(node=>node.id===3));
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.deepEqual((await read()).nodes,original);
  await page.getByLabel('Zoom').selectOption('1.5');await settle();
  await drag(await point(1,45),await point(2,55));state=await read();assert.equal(state.selection.anchorId,1);assert.equal(state.selection.id,2);
  // Paste replaces the entire range, not merely the head paragraph's textarea.
  const beforePaste=state.selection;
  await input.evaluate(el=>{const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});event.clipboardData.setData('text/plain','PASTE');el.dispatchEvent(event);});await settle();
  assert.equal((await read()).nodes[0].text,original[0].text.slice(0,beforePaste.anchor)+'PASTE'+original[1].text.slice(beforePaste.focus));
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.deepEqual((await read()).nodes,original);
  console.log(name,'cross-paragraph drag, highlight, copy, replace, delete, Enter, keyboard, zoom and undo passed');assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
