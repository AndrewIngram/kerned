import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();try{for(const width of [1100,390]){
 const page=await browser.newPage({viewport:{width,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5173/editor.html');await page.waitForFunction(()=>window.hybridSpike);
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const read=()=>page.evaluate(()=>window.hybridSpike.read());
 const menu=async name=>{if(name.includes('Table')||name.includes('table'))await page.locator('.table-menu summary').click();else if(!['Block quote','Indent list item','Outdent list item'].includes(name))await page.locator('.blocks-menu summary').click();await page.getByRole('button',{name,exact:true}).click();await settle();};
 await page.evaluate(()=>window.hybridSpike.select(1,0));await menu('Block quote');assert.equal(await page.locator('.quote-rule').count(),1);
 await page.keyboard.type('Quoted ');await settle();assert.ok((await read()).nodes[0].text.startsWith('Quoted '));
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await page.keyboard.press('Control+a');await page.keyboard.type('Across containers');await settle();assert.equal((await read()).nodes.length,1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.equal((await read()).nodes.length,4);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.equal(await page.locator('.quote-rule').count(),0);
 await page.evaluate(()=>window.hybridSpike.select(1,0));await menu('Bullet list');assert.equal(await page.locator('.list-marker').first().innerText(),'•');
 await page.keyboard.press('End');await page.keyboard.press('Enter');await page.keyboard.type('Second item');await settle();assert.equal(await page.locator('.list-marker').count(),2);
 await page.keyboard.press('Tab');await settle();assert.equal(await page.locator('.list-marker').count(),2);assert.equal((await page.getByRole('status').allTextContents()).join(''),'');
 await page.keyboard.press('Shift+Tab');await settle();assert.equal((await page.getByRole('status').allTextContents()).join(''),'');
 await menu('Numbered list');assert.equal(await page.locator('.list-marker').first().innerText(),'1.');
 await menu('Numbered list');assert.equal(await page.locator('.list-marker').count(),0);
 await page.evaluate(()=>window.hybridSpike.select(1,0));await page.keyboard.down('Shift');for(let i=0;i<5;i++)await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift');
 await page.getByRole('button',{name:'Underline',exact:true}).click();await settle();assert.ok((await read()).nodes[0].marks.some(s=>(s.mark.type==='underline')));
 await page.getByRole('button',{name:'Clear formatting',exact:true}).click();await settle();assert.equal((await read()).nodes[0].marks.length,0);
 await page.getByRole('button',{name:'Add comment',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByLabel('Reply',{exact:true}).fill('A comment');await settle();assert.equal((await page.evaluate(()=>window.hybridSpike.comments())).threads[0].messages[0].reply,'A comment');
 assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`artifacts/check-editor-blocks-${name}-${width}.png`});console.log(name,'quotes, lists, indentation, marks and comments passed');
 }}finally{await browser.close();}
}
