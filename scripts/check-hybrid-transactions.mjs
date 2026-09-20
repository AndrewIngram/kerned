import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base=process.env.HYBRID_URL??'http://127.0.0.1:5176/hybrid-editor.html',results=[];
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{for(const width of [1100,420]){
  const page=await browser.newPage({viewport:{width,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}?stream=2000&paused=1`);await page.waitForFunction(()=>window.hybridSpike);
  const selections=await page.evaluate(()=>window.hybridSpike.checkSelections());
  const containers=await page.evaluate(()=>window.hybridSpike.checkContainers());
  const extensions=await page.evaluate(()=>window.hybridSpike.checkExtensions());
  const core=await page.evaluate(()=>window.hybridSpike.checkTransactions());
  const read=()=>page.evaluate(()=>window.hybridSpike.read());
  const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const original=(await read()).nodes.find(n=>n.id===1),at=original.inline[0].index;
  const saved=await page.evaluate(at=>window.hybridSpike.anchor(1,at,1),at);
  await page.evaluate(at=>window.hybridSpike.select(1,at),at);await settle();
  await page.keyboard.press('Enter');await settle();
  let state=await read();const right=state.selection.id;assert.ok(right<0);assert.equal(state.selection.focus,0);
  assert.equal(state.nodes.find(n=>n.id===right).inline[0].index,0);
  const resolved=await page.evaluate(a=>window.hybridSpike.resolveAnchor(a),JSON.parse(JSON.stringify(saved)));
  assert.equal(resolved.status,'resolved');assert.equal(resolved.anchor.blockKey,state.nodes.find(n=>n.id===right).key);assert.equal(resolved.anchor.offset,0);
  await page.keyboard.type('Hello world ');await settle();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();
  assert.equal((await read()).nodes.find(n=>n.id===right).text,original.text.slice(at));
  await page.getByRole('button',{name:'Redo',exact:true}).click();await settle();
  assert.ok((await read()).nodes.find(n=>n.id===right).text.startsWith('Hello world '));
  await page.evaluate(id=>window.hybridSpike.select(id,0),right);await settle();await page.keyboard.press('Backspace');await settle();
  state=await read();assert.ok(!state.nodes.some(n=>n.id===right));assert.equal(state.selection.id,1);assert.equal(state.selection.focus,at);
  assert.equal(state.nodes[0].inline[0].index,at+12);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.ok((await read()).nodes.some(n=>n.id===right));
  // Streaming remains outside user history, including after structural edits.
  await page.evaluate(()=>window.hybridSpike.resume());await page.waitForFunction(()=>window.hybridSpike.metrics().samples.length>3);
  await page.evaluate(()=>window.hybridSpike.pause());await settle();const loaded=(await read()).nodes.length;
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();
  state=await read();assert.equal(state.nodes.length,loaded-1);assert.deepEqual(state.nodes[0],original);
  // A structural edit changes document length, not the stream's source cursor.
  await page.evaluate(at=>window.hybridSpike.select(1,at),at);await settle();await page.keyboard.press('Enter');await settle();
  await page.evaluate(()=>window.hybridSpike.resume());await page.waitForFunction(()=>window.hybridSpike.probe([]).complete);await settle();
  state=await read();assert.equal(state.nodes.length,2001);assert.equal(state.nodes.at(-1).id,2005);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.equal((await read()).nodes.length,2000);
  assert.equal((await page.evaluate(()=>window.hybridSpike.metrics())).stalePaints,0);assert.deepEqual(errors,[]);
  results.push({browser:name,width,core,extensions,containers,selections,checks:'passed'});console.log(name,width,core);await page.close();
 }}finally{await browser.close();}
}
await writeFile('artifacts/hybrid-transactions.json',JSON.stringify(results,null,2)+'\n');
