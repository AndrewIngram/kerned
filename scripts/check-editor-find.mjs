import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const reports=[];

for(const name of (process.env.BROWSERS??'chromium,firefox,webkit').split(',')){
  const browser=await {chromium,firefox,webkit}[name].launch();

  try{
    for(const width of [1100,390]){
      const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.routeWebSocket(url=>url.pathname==='/',()=>{});
      const settle=async()=>{await page.waitForFunction(()=>document.querySelector('.find-count')?.getAttribute('aria-busy')!=='true');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};

      const input=page.getByRole('textbox',{name:'Find in document',exact:true});

      const count=async()=>{await page.locator('.find-count[aria-busy="false"]').waitFor();

return page.locator('.find-count').innerText();};

      const pixels=()=>page.evaluate(()=>{
        const canvas=document.querySelector('canvas'),data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        let active=0,other=0;

for(let i=0;i<data.length;i+=4){if(data[i]===245&&data[i+1]===185&&data[i+2]===65)active++;

if(data[i]===255&&data[i+1]===236&&data[i+2]===151)other++;}

        return {active,other};
      });

      await page.goto('http://127.0.0.1:5173/editor.html');await page.waitForFunction(()=>window.editorDiagnostics);
      const selection=await page.evaluate(()=>window.editorDiagnostics.read().selection);
      await page.keyboard.press('Meta+f');await input.fill('ideas');await settle();
      assert.equal(await count(),'1 of 2');
      assert.ok(await page.evaluate(()=>{
        const bar=document.querySelector('.find-bar').getBoundingClientRect(),canvas=document.querySelector('canvas').getBoundingClientRect(),state=window.editorDiagnostics.read();

        return canvas.top+state.scene[0].y-state.scroll>=bar.bottom;
      }),'Floating bar leaves the first match visible');
      let colors=await pixels();assert.ok(colors.active>20&&colors.other>20,'Canvas draws current and other matches');
      await input.press('Enter');await settle();assert.equal(await count(),'2 of 2');
      assert.equal(await input.evaluate(el=>el===document.activeElement),true);
      await input.press('Enter');assert.equal(await count(),'1 of 2');
      await input.press('Shift+Enter');assert.equal(await count(),'2 of 2');
      await input.fill('IDEAS');assert.equal(await count(),'1 of 2');
      await page.getByRole('button',{name:'Match case',exact:true}).click();assert.equal(await count(),'No results');
      assert.equal(await page.getByRole('button',{name:'Next match',exact:true}).isDisabled(),true);
      await page.getByRole('button',{name:'Match case',exact:true}).click();assert.equal(await count(),'1 of 2');
      await input.fill('missing [.*]');await settle();assert.equal(await count(),'No results');
      colors=await pixels();assert.equal(colors.active+colors.other,0,'No stale highlights');
      await input.fill('ideas');await settle();
      assert.deepEqual(await page.evaluate(()=>window.editorDiagnostics.read().selection),selection);
      assert.deepEqual(await page.evaluate(()=>window.editorDiagnostics.history()),{undo:0,redo:0});
      await page.screenshot({path:`artifacts/editor-find-${name}-${width}.png`});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await input.press('Escape');assert.equal(await input.count(),0);
      await page.getByRole('button',{name:'Find',exact:true}).click();assert.equal(await input.inputValue(),'ideas');
      await input.press('Escape');

      // A real table edit, then Find opened from its textarea.
      await page.locator('.table-menu summary').click();
      await page.getByRole('button',{name:'Table (3 × 3)',exact:true}).click();await settle();
      await page.getByRole('button',{name:'Edit cell 1, 1',exact:true}).click();
      const cell=page.getByLabel('Cell 1, 1 text',{exact:true});await cell.fill('Table ideas, more ideas');await settle();
      const tableSelection=await page.evaluate(()=>window.editorDiagnostics.read().selection);
      const tableHistory=await page.evaluate(()=>window.editorDiagnostics.history());
      await cell.press('Control+f');await input.fill('ideas');await settle();assert.equal(await count(),'1 of 4');
      await input.press('Enter');await settle();
      assert.equal(await page.locator('[data-find-active="true"]').innerText(),'ideas','Table cell current match is highlighted');
      assert.deepEqual(await page.evaluate(()=>window.editorDiagnostics.read().selection),tableSelection);
      assert.deepEqual(await page.evaluate(()=>window.editorDiagnostics.history()),tableHistory);
      await input.fill('Table ideas');await settle();assert.equal(await count(),'1 of 1');
      await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.equal(await count(),'No results','Undo refreshes open Find');
      await page.getByRole('button',{name:'Redo',exact:true}).click();await settle();assert.equal(await count(),'1 of 1','Redo refreshes open Find');
      await page.getByRole('button',{name:'Close find',exact:true}).click();

      // Results stay live while typing outside Find, with no search history entry.
      await page.getByRole('button',{name:'Find',exact:true}).click();await input.fill('ideas');await settle();
      await page.evaluate(()=>window.editorDiagnostics.select(1,5));await page.keyboard.insertText('new ');await settle();
      assert.equal(await count(),'1 of 4');
      assert.equal(await page.evaluate(()=>window.editorDiagnostics.find().matches[0].from),9);
      await page.keyboard.press('Escape');assert.equal(await input.count(),0);

      await page.goto('http://127.0.0.1:5173/editor.html?sample=warbreaker');
      await page.waitForFunction(()=>window.editorDiagnostics?.metrics().completedAt,{},{timeout:60000});
      const before=await page.evaluate(()=>({selection:window.editorDiagnostics.read().selection,layouts:window.editorDiagnostics.metrics().layoutCalls}));

      const apiTimings=await page.evaluate(async()=>{
        const {createFind}=await import('/src/editor/index.ts'),{demoSchema}=await import('/src/extensions/demo-schema.ts');
        const nodes=window.editorDiagnostics.read().nodes,find=createFind(demoSchema,()=>nodes);

        return ['Breath','Vivenna','the','e','[.*]'].map(query=>{const start=performance.now(),state=find.setQuery(query);

return {query,matches:state.matches.length,ms:performance.now()-start};});
      });

      await page.keyboard.press('Meta+f');
      const started=performance.now();await input.fill('Breath');await settle();const searchPaintMs=performance.now()-started;
      const total=await page.evaluate(()=>window.editorDiagnostics.find().matches.length);assert.ok(total>100);
      const atFirst=await page.evaluate(()=>window.editorDiagnostics.find().active);
      await input.press('Shift+Enter');await settle();
      await page.waitForFunction(()=>window.editorDiagnostics.read().scroll>10000);
      assert.equal(await count(),`${total} of ${total}`);
      colors=await pixels();assert.ok(colors.active>20,'Far-offscreen final match is composed and visible');
      await page.screenshot({path:`artifacts/editor-find-book-${name}-${width}.png`});
      await input.press('Enter');await settle();
      assert.deepEqual(await page.evaluate(()=>window.editorDiagnostics.find().active),atFirst,'Book navigation wraps');
      const after=await page.evaluate(()=>({selection:window.editorDiagnostics.read().selection,layouts:window.editorDiagnostics.metrics().layoutCalls,find:window.editorDiagnostics.find()}));
      assert.deepEqual(after.selection,before.selection);
      assert.ok(after.layouts-before.layouts<150,'Find composes nearby matches, not the whole book');
      // A resize reflows the view while keeping the current result available.
      await page.setViewportSize({width:width===1100?760:420,height:900});
      await page.waitForFunction(()=>!window.editorDiagnostics.probe([]).reflowPending,{},{timeout:30000});
      await input.press('Shift+Enter');await settle();assert.ok((await pixels()).active>20);
      await input.press('Escape');await settle();assert.equal(await input.count(),0);
      assert.deepEqual(errors,[]);
      reports.push({browser:name,width,matches:total,searchPaintMs,layouts:after.layouts-before.layouts,apiTimings});
      console.log(JSON.stringify(reports.at(-1)));await page.close();
    }
  }finally{await browser.close();}
}

await writeFile('artifacts/editor-find.json',JSON.stringify(reports,null,2)+'\n');
