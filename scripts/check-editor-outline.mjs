import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';

for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();

try{
  const streaming=await browser.newPage({viewport:{width:1100,height:800}});
  await streaming.goto('http://127.0.0.1:5173/editor.html?sample=warbreaker&paused=1');
  await streaming.waitForFunction(()=>window.editorDiagnostics);
  await streaming.getByRole('button',{name:'Open document outline',exact:true}).focus();
  const pendingButtons=streaming.locator('.outline-items button');
  const fullCount=await pendingButtons.count();
  assert.ok(fullCount>50,'Full outline must exist before streaming');
  assert.ok(await streaming.locator('.outline-items button:disabled').count()>40);
  assert.equal(await pendingButtons.first().isEnabled(),true);
  assert.equal(await pendingButtons.last().isDisabled(),true);
  const beforePendingClick=await streaming.evaluate(()=>scrollY);
  await pendingButtons.last().evaluate(el=>el.click());
  assert.equal(await streaming.evaluate(()=>scrollY),beforePendingClick);
  await streaming.keyboard.press('Escape');
  await streaming.evaluate(()=>window.editorDiagnostics.select(1,0));
  await streaming.keyboard.type('Edited ');
  await streaming.getByRole('button',{name:'Open document outline',exact:true}).focus();
  assert.ok((await pendingButtons.first().innerText()).startsWith('Edited '));
  assert.equal(await pendingButtons.count(),fullCount);
  await streaming.keyboard.press('Escape');
  await streaming.locator('.blocks-menu summary').click();
  await streaming.getByRole('button',{name:'Paragraph',exact:true}).click();
  await streaming.getByRole('button',{name:'Open document outline',exact:true}).focus();
  assert.equal(await pendingButtons.count(),fullCount-1,'Removed heading must not return from source outline');
  await streaming.evaluate(()=>window.editorDiagnostics.resume());
  await streaming.waitForFunction(()=>window.editorDiagnostics.probe([]).complete);
  assert.equal(await pendingButtons.count(),fullCount-1);
  assert.equal(await streaming.locator('.outline-items button:disabled').count(),0);
  await pendingButtons.last().click();
  await streaming.waitForFunction(()=>scrollY>10000);
  await streaming.close();console.log(name,'full pending outline, disabled navigation, live edits and progressive availability passed');

  for(const width of [1100,390]){
   const page=await browser.newPage({viewport:{width,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:5173/editor.html?sample=warbreaker');await page.waitForFunction(()=>window.editorDiagnostics);
   await page.getByRole('button',{name:'Open document outline',exact:true}).waitFor();await page.waitForFunction(()=>window.editorDiagnostics.probe([]).complete);
   const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const before=await page.evaluate(()=>window.editorDiagnostics.read().selection);
   const trigger=page.getByRole('button',{name:'Open document outline',exact:true});
   await trigger.focus();await page.locator('.outline-panel').waitFor();
   await page.locator('.outline-items button').last().click();await settle();
   assert.ok(await page.evaluate(()=>scrollY>10000));
   assert.deepEqual(await page.evaluate(()=>window.editorDiagnostics.read().selection),before,'Navigation must preserve selection');
   await page.keyboard.press('Escape');

   if(width>600){const marks=await page.locator('.outline-marks').evaluate(el=>{const r=el.getBoundingClientRect(),active=el.querySelector('[data-active="true"]').getBoundingClientRect(),all=el.querySelectorAll('.outline-mark');

return {top:r.top,bottom:r.bottom,activeTop:active.top,activeBottom:active.bottom,scroll:el.scrollTop,gap:all[1].getBoundingClientRect().top-all[0].getBoundingClientRect().top,overflow:getComputedStyle(el).overflow};});

assert.ok(marks.activeTop>=marks.top&&marks.activeBottom<=marks.bottom);assert.equal(marks.gap,10);assert.equal(marks.overflow,'hidden');assert.ok(marks.scroll>0);}

   await trigger.press('Enter');await page.locator('.outline-panel').waitFor();
   await page.locator('.outline-items button').first().click();await settle();assert.ok(await page.evaluate(()=>scrollY<30));
   await page.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');

   const rail=await page.locator('.document-outline').evaluate(el=>{const r=el.getBoundingClientRect(),toolbar=document.querySelector('.minimal-toolbar').getBoundingClientRect();

return {center:r.top+r.height/2,target:toolbar.height+(innerHeight-toolbar.height)/2,height:r.height,max:(innerHeight-toolbar.height)*.8};});

assert.ok(Math.abs(rail.center-rail.target)<1);assert.ok(rail.height<=rail.max+1);
   await trigger.press('Enter');await page.locator('.outline-panel').waitFor();await page.mouse.click(5,600);assert.equal(await trigger.getAttribute('aria-expanded'),'false');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
   await trigger.focus();await page.locator('.outline-panel').waitFor();await page.screenshot({path:`artifacts/outline-${name}-${width}.png`});
   await page.close();console.log(name,width,'outline navigation, dismissal, preserved selection and responsive fit passed');
  }

  const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/editor.html');await page.waitForFunction(()=>window.editorDiagnostics);
  assert.equal(await page.locator('.document-outline').count(),0);

  const result=await page.evaluate(async()=>{
   const {createSchema}=await import('/src/editor/index.ts');
   const {createOutlineExtension}=await import('/src/extensions/outline.ts');
   const schema=createSchema([{name:'custom',version:1,kind:'container',accepts:()=>true,validateUpdate(){},content:{children:n=>n.children??[],withChildren:(n,children)=>({...n,children}),validateChildren(){}}}]);
   let reads=0;

const outline=createOutlineExtension(schema,n=>{reads++;

return n.heading?{level:n.heading,title:n.label}:null;});

   const first={id:1,key:'a',heading:1,label:'Title'},deep={id:3,key:'c',heading:4,label:'Deep'},second={id:2,key:'b',heading:2,label:'Duplicate',children:[deep]};
   const nodes=[first,second,{id:4,key:'d',heading:2,label:'Duplicate'}];
   const a=outline.read(nodes),calls=reads,same=outline.read(nodes)===a&&reads===calls;
   const edited=outline.read([first,{...second,label:'Changed'},nodes[2]]),afterEdit=reads;
   const streamed=outline.read([first,{id:5,key:'e',heading:3,label:''}]);

   return {a,edited,streamed,same,newReads:afterEdit-calls};
  });

  assert.equal(result.same,true);assert.equal(result.newReads,1);assert.deepEqual(result.a.map(e=>[e.depth,e.parentKey]),[[0,null],[1,'a'],[2,'b'],[1,'a']]);assert.equal(result.edited[1].title,'Changed');assert.equal(result.streamed.length,2);
  await page.locator('.blocks-menu summary').click();await page.getByRole('button',{name:'Heading 2',exact:true}).click();await page.locator('.document-outline').waitFor();
  await page.getByRole('button',{name:'Open document outline',exact:true}).focus();await page.locator('.outline-panel').waitFor();
  assert.equal(await page.locator('.outline-items button').count(),1);
  await page.keyboard.press('Escape');await page.evaluate(()=>window.editorDiagnostics.select(1,0));await page.keyboard.type('Renamed ');
  await page.getByRole('button',{name:'Open document outline',exact:true}).focus();await page.locator('.outline-panel').waitFor();assert.ok((await page.locator('.outline-items button').innerText()).startsWith('Renamed '));
  await page.getByRole('button',{name:'Undo',exact:true}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await page.locator('.document-outline').count(),0);
  await page.close();console.log(name,'generic extraction, nested/skipped levels, caching, streaming and editing passed');
 }finally{await browser.close();}
}
