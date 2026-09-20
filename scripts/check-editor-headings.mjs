import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();try{for(const width of [1100,390]){
 const page=await browser.newPage({viewport:{width,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5173/editor.html');await page.waitForFunction(()=>window.hybridSpike);
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const read=()=>page.evaluate(()=>window.hybridSpike.read());
 const menu=async label=>{await page.locator('.blocks-menu summary').click();await page.getByRole('button',{name:label,exact:true}).click();await settle();};
 const original=(await read()).nodes[0];
 for(const level of [1,2,3,4]){
 await page.evaluate(()=>window.hybridSpike.select(1,5));await menu(`Heading ${level}`);
 let state=await read();assert.equal(state.nodes[0].kind,'heading');assert.equal(state.nodes[0].level,level);assert.equal(state.nodes[0].text,original.text);assert.equal(state.selection.focus,5);
 const lineHeight=[44,36,32,28][level-1];assert.equal(state.scene[0].height%lineHeight,0);assert.ok(state.scene.every(p=>p.y%4===0));
 await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.equal((await read()).nodes[0].kind,'paragraph');
 await page.getByRole('button',{name:'Redo',exact:true}).click();await settle();assert.equal((await read()).nodes[0].level,level);
 await menu('Paragraph');
 }
 await menu('Heading 2');await page.evaluate(()=>{const n=window.hybridSpike.read().nodes[0];window.hybridSpike.select(n.id,n.text.length);});await page.keyboard.press('Enter');await page.keyboard.type('Following paragraph');await settle();
 let state=await read();assert.equal(state.nodes[0].kind,'heading');assert.equal(state.nodes[1].kind,'paragraph');assert.equal(state.nodes[1].text,'Following paragraph');
 await page.evaluate(()=>window.hybridSpike.select(1,0));await page.keyboard.press('Control+a');await page.keyboard.type('Replacement');await settle();assert.equal((await read()).nodes.length,1);
 assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.close();
 console.log(name,width,'heading levels, grid, undo, split and cross-block replacement passed');
 }
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/editor.html?sample=warbreaker');await page.waitForFunction(()=>window.hybridSpike?.read().nodes.some(n=>n.kind==='heading'));assert.ok((await page.evaluate(()=>window.hybridSpike.read().nodes)).some(n=>n.kind==='heading'));await page.close();
 }finally{await browser.close();}
}
