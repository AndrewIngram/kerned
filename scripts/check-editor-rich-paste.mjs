import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
const fixture='<h1>Title</h1><p>Some <strong>bold</strong>, <em>italic</em> and <u>underlined</u> text.</p><blockquote><p>First quote</p><p>Second quote</p></blockquote><ol start="3"><li><p>Item</p><ul><li><p>Nested</p></li></ul></li></ol><table><tr><th>Key</th><th>Value</th></tr><tr><td><strong>A</strong></td><td>B</td></tr></table><h4>End</h4>';
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const paste=async data=>{await page.locator('.text-capture').evaluate((el,data)=>{const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});for(const [type,value] of Object.entries(data))event.clipboardData.setData(type,value);el.dispatchEvent(event);},data);await settle();assert.equal(await page.locator('.input-notice').innerText(),'');};
 const copy=()=>page.locator('.text-capture').evaluate(el=>{const event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});el.dispatchEvent(event);return Object.fromEntries([...event.clipboardData.types].map(type=>[type,event.clipboardData.getData(type)]));});
 await page.goto('http://127.0.0.1:5173/editor.html');await page.waitForFunction(()=>window.hybridSpike);
 await page.evaluate(()=>window.hybridSpike.select(1,0));await page.keyboard.press('ControlOrMeta+a');await paste({'text/html':fixture,'text/plain':'fallback'});
 await page.keyboard.press('ControlOrMeta+a');const rich=await copy();
 for(const tag of ['<h1>','<h4>','<strong>','<em>','<u>','<blockquote>','<ol start="3">','<ul','<table>','<th'])assert.ok(rich['text/html'].includes(tag),tag);
 await paste(rich);await page.keyboard.press('ControlOrMeta+a');assert.equal((await copy())['text/html'],rich['text/html']);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await page.getByRole('button',{name:'Redo',exact:true}).click();await page.keyboard.press('ControlOrMeta+a');assert.equal((await copy())['text/html'],rich['text/html']);
 // Fresh page has no local fragment token: exported HTML must retain structure.
 await page.reload();await page.waitForFunction(()=>window.hybridSpike);await page.evaluate(()=>window.hybridSpike.select(1,0));await page.keyboard.press('ControlOrMeta+a');await paste(rich);await page.keyboard.press('ControlOrMeta+a');assert.equal((await copy())['text/html'],rich['text/html']);
 // Partial inline copy must not split the destination paragraph or lose marks.
 await page.reload();await page.waitForFunction(()=>window.hybridSpike);await page.evaluate(()=>window.hybridSpike.select(1,0));await page.keyboard.press('ControlOrMeta+a');await paste({'text/html':'<p>before <strong>bold</strong> after</p>'});
 const id=await page.evaluate(()=>window.hybridSpike.read().nodes[0].id);
 await page.evaluate(id=>window.hybridSpike.select(id,7),id);await settle();await page.keyboard.down('Shift');for(let i=0;i<4;i++)await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift');const partial=await copy();
 await page.evaluate(id=>window.hybridSpike.select(id,0),id);await settle();await paste(partial);
 const nodes=await page.evaluate(()=>window.hybridSpike.read().nodes);assert.equal(nodes.length,1);assert.equal(nodes[0].text,'boldbefore bold after');assert.ok(nodes[0].spans.some(s=>s.start===0&&s.end===4&&s.bold));
 // A whole novel must preserve every supported block and mark through HTML.
 await page.goto('http://127.0.0.1:5173/editor.html?sample=warbreaker');await page.waitForFunction(()=>window.hybridSpike?.probe([]).complete);
 await page.evaluate(()=>window.hybridSpike.select(1,0));await page.keyboard.press('ControlOrMeta+a');const book=await copy();assert.ok(book['text/plain'].length>1_000_000);
 await page.goto('http://127.0.0.1:5173/editor.html');await page.waitForFunction(()=>window.hybridSpike);await page.evaluate(()=>window.hybridSpike.select(1,0));await page.keyboard.press('ControlOrMeta+a');await paste(book);await page.keyboard.press('ControlOrMeta+a');assert.equal((await copy())['text/html'],book['text/html']);
 assert.deepEqual(errors,[]);console.log(name,'rich HTML, local fragments, nested lists, quotes, tables, partial marks and undo/redo passed');
 }finally{await browser.close();}
}
