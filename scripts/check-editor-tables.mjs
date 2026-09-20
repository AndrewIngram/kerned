import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();try{for(const width of [1100,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log(e.message)});await page.goto('http://127.0.0.1:5173/editor.html');await page.waitForFunction(()=>window.hybridSpike);
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await page.locator('.table-menu summary').click();await page.getByRole('button',{name:'Table (3 × 3)',exact:true}).click();await settle();
 assert.equal(await page.locator('[data-cell]').count(),9);
 await page.getByRole('button',{name:'Edit cell 1, 1',exact:true}).click();await page.getByLabel('Cell 1, 1 text',{exact:true}).fill('Alpha');await settle();
 await page.keyboard.press('Tab');await page.getByLabel('Cell 1, 2 text',{exact:true}).fill('Beta');await settle();
 await page.getByRole('button',{name:'Select cell 1, 1',exact:true}).click();await page.getByRole('button',{name:'Select cell 2, 2',exact:true}).click({modifiers:['Shift']});await settle();
 assert.equal(await page.locator('[data-cell][data-selected="true"]').count(),4);
 await page.keyboard.press('Backspace');await settle();
 assert.equal(await page.locator('.table-block').innerText().then(t=>t.includes('Alpha')),false);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.equal(await page.locator('[data-cell][data-selected="true"]').count(),4);
 assert.ok((await page.locator('.table-block').innerText()).includes('Alpha'));
 await page.locator('.table-menu summary').click();await page.getByRole('button',{name:'Add table row',exact:true}).click();await settle();assert.equal(await page.locator('[data-cell]').count(),12);
 await page.locator('.table-menu summary').click();await page.getByRole('button',{name:'Add table column',exact:true}).click();await settle();assert.equal(await page.locator('[data-cell]').count(),16);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.equal(await page.locator('[data-cell]').count(),12);
 assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`artifacts/check-editor-tables-${name}-${width}.png`});console.log(name,'table insertion, cell editing, Tab, rectangular selection, deletion and undo passed');
 }}finally{await browser.close();}
}
