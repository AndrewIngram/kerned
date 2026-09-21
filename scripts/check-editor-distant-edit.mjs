import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();try{
 const page=await browser.newPage({viewport:{width:1100,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173/editor.html?sample=warbreaker');await page.waitForFunction(()=>window.editorDiagnostics?.probe([]).complete);
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 for(const minimumId of [100,1000,6000]){
 const id=await page.evaluate(minimumId=>{const n=window.editorDiagnostics.read().nodes.find(n=>n.id>minimumId&&n.kind==='paragraph');window.editorDiagnostics.scrollTo(n.id,-30);return n.id;},minimumId);await settle();
 const point=await page.evaluate(id=>{const state=window.editorDiagnostics.read(),p=state.scene.find(p=>p.id===id),r=document.querySelector('canvas').getBoundingClientRect();return{x:r.left+50,y:r.top+p.y-state.scroll+12};},id);
 await page.mouse.click(point.x,point.y);await settle();
 const before=await page.evaluate(id=>({scroll:scrollY,node:window.editorDiagnostics.read().nodes.find(n=>n.id===id),selection:window.editorDiagnostics.read().selection}),id);
 await page.keyboard.type('XYZ');await settle();
 const after=await page.evaluate(id=>({scroll:scrollY,node:window.editorDiagnostics.read().nodes.find(n=>n.id===id),selection:window.editorDiagnostics.read().selection,notice:document.querySelector('.input-notice')?.textContent}),id);
 console.log(name,JSON.stringify({before:{scroll:before.scroll,selection:before.selection},after:{scroll:after.scroll,selection:after.selection,textChanged:after.node.text!==before.node.text,notice:after.notice},errors}));
 assert.equal(after.node.text,before.node.text.slice(0,before.selection.focus)+'XYZ'+before.node.text.slice(before.selection.focus),'The distant edit was discarded or inserted at the wrong location');assert.ok(Math.abs(after.scroll-before.scroll)<5,'Typing moved the page away from the edit');await page.keyboard.press('Backspace');await settle();
 await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();
 assert.equal(await page.evaluate(id=>window.editorDiagnostics.read().nodes.find(n=>n.id===id).text,id),after.node.text);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();
 assert.equal(await page.evaluate(id=>window.editorDiagnostics.read().nodes.find(n=>n.id===id).text,id),before.node.text);
 assert.ok(Math.abs(await page.evaluate(()=>scrollY)-before.scroll)<5,'Undo moved the page');
 }
 assert.deepEqual(errors,[]);await page.close();
 }finally{await browser.close();}
}
