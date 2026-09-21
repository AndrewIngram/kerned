import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();try{for(const width of [1100,390,320]){
 const page=await browser.newPage({viewport:{width,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5173/editor.html');await page.waitForFunction(()=>window.editorDiagnostics);
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const summary=page.locator('.blocks-menu summary');const label=async expected=>assert.equal((await summary.innerText()).trim(),expected);
 const menu=async name=>{if(name!=='Block quote')await summary.click();await page.getByRole('button',{name,exact:true}).click();await settle();};
 await label('Paragraph');const pickerWidth=(await summary.boundingBox()).width;
 const rects=await page.locator('.toolbar-inner').evaluate(el=>[...el.children].map(n=>({label:n.getAttribute('aria-label')??n.className,x:n.getBoundingClientRect().x,right:n.getBoundingClientRect().right})));
 assert.equal(rects[0].label,'blocks-menu');assert.equal(rects.at(-1).label,'toolbar-trailing');assert.ok(rects.every(r=>r.x>=0&&r.right<=width));
 await menu('Heading 1');await label('Heading 1');
 await page.keyboard.press('Control+a');await settle();await label('Mixed');
 await menu('Heading 3');await label('Heading 3');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();await label('Mixed');
 await page.evaluate(()=>window.editorDiagnostics.select(2,0));await settle();await label('Paragraph');
 await menu('Bullet list');await label('Bullet list');await menu('Numbered list');await label('Numbered list');assert.equal((await summary.boundingBox()).width,pickerWidth);await menu('Numbered list');await label('Paragraph');
 await menu('Block quote');await label('Paragraph');assert.equal(await page.getByRole('button',{name:'Block quote',exact:true}).getAttribute('aria-pressed'),'true');await menu('Block quote');await label('Paragraph');
 await page.evaluate(()=>window.editorDiagnostics.select(1,0));await page.keyboard.press('Control+a');await settle();await menu('Block quote');assert.equal(await page.locator('[data-quote]').count(),1);await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.equal(await page.locator('[data-quote]').count(),0);
 await page.evaluate(()=>window.editorDiagnostics.select(1,0));await menu('Block quote');await page.keyboard.press('Control+a');await settle();await menu('Block quote');assert.equal(await page.locator('[data-quote]').count(),1);await menu('Block quote');assert.equal(await page.locator('[data-quote]').count(),0);
 await summary.click();assert.ok((await page.getByRole('group',{name:'Block commands'}).boundingBox()).x>=0);await page.keyboard.press('Escape');assert.equal(await page.locator('.blocks-menu').getAttribute('open'),null);await summary.click();await page.locator('canvas').click({position:{x:240,y:500}});assert.equal(await page.locator('.blocks-menu').getAttribute('open'),null);
 assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.close();console.log(name,width,'toolbar order, current and mixed block labels passed');
 }}finally{await browser.close();}
}
