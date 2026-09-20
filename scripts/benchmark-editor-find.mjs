import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const reports=[];
for(const name of (process.env.BROWSERS??'chromium').split(',')){
  const browser=await {chromium,firefox,webkit}[name].launch();
  try{
    const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.routeWebSocket(url=>url.pathname==='/',()=>{});
    await page.goto(process.env.FIND_URL??'http://127.0.0.1:5173/editor.html?sample=war-and-peace');
    await page.waitForFunction(()=>window.hybridSpike?.probe([]).complete,null,{timeout:90000});
    await page.getByRole('button',{name:'Find',exact:true}).click();
    const input=page.getByRole('textbox',{name:'Find in document',exact:true});
    await page.evaluate(()=>{
      const input=document.querySelector('.find-bar input'),events=[];
      window.findBenchmark={events};
      window.addEventListener('input',event=>{
        if(event.target!==input)return;
        const value=input.value,started=performance.now(),row={value,started};events.push(row);
        requestAnimationFrame(()=>{row.inputPaintMs=performance.now()-started;row.paintedValue=input.value;});
      },true);
      window.addEventListener('input',event=>{if(event.target===input)events.at(-1).handlerMs=performance.now()-events.at(-1).started;});
    });
    let cdp;
    if(process.env.PROFILE&&name==='chromium'){
      cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
    }
    for(let trial=0;trial<Number(process.env.TRIALS??2);trial++){
      await input.fill('');await page.waitForFunction(()=>window.hybridSpike.find().query==='');
      await input.pressSequentially('Pierre',{delay:30});
      await page.waitForFunction(()=>window.hybridSpike.find().query==='Pierre');
      await input.fill('e');await page.waitForFunction(()=>window.hybridSpike.find().query==='e');
      await input.fill('the');await page.waitForFunction(()=>window.hybridSpike.find().query==='the');
    }
    const burst=await input.evaluate(async input=>{
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      const queries=['e','th','the','Pi','Pier','Pierre'],started=performance.now(),delays=[];
      await Promise.all(queries.map((query,i)=>new Promise(resolve=>setTimeout(()=>{
        delays.push(performance.now()-started-i*12);setter.call(input,query);input.dispatchEvent(new Event('input',{bubbles:true}));resolve();
      },i*12))));
      return {maxDispatchDelayMs:Math.max(...delays),value:input.value};
    });
    assert.equal(burst.value,'Pierre');await page.waitForFunction(()=>window.hybridSpike.find().query==='Pierre');
    assert.equal(await page.evaluate(()=>window.hybridSpike.find().matches.length),1964);
    // Cancel from the same task, before a pending query has a chance to finish.
    await input.evaluate(input=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'e');
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    });
    await page.waitForTimeout(50);
    assert.equal(await input.count(),0);assert.equal(await page.evaluate(()=>window.hybridSpike.find().query),'');
    await page.getByRole('button',{name:'Find',exact:true}).click();assert.equal(await input.inputValue(),'e','Reopening retains the latest draft, even if its search was cancelled');
    await input.fill('Pierre');await page.waitForFunction(()=>window.hybridSpike.find().query==='Pierre');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    if(cdp){const {profile}=await cdp.send('Profiler.stop');await writeFile(process.env.PROFILE,JSON.stringify(profile));}
    const report=await page.evaluate(async()=>{
      const {createFind}=await import('/src/editor/index.ts'),{demoSchema}=await import('/src/extensions/demo-schema.ts');
      const nodes=window.hybridSpike.read().nodes,find=createFind(demoSchema,()=>nodes);
      const queries=['P','Pi','Pierre','e','the'];
      const timings=queries.map(query=>{const start=performance.now(),state=find.setQuery(query);return {query,matches:state.matches.length,ms:performance.now()-start};});
      return {blocks:nodes.length,characters:nodes.reduce((n,node)=>n+(node.text?.length??0),0),events:window.findBenchmark.events,timings};
    });
    assert.deepEqual(errors,[]);reports.push({browser:name,burst,...report});
    console.log(JSON.stringify({browser:name,blocks:report.blocks,characters:report.characters,maxHandlerMs:Math.max(...report.events.map(e=>e.handlerMs)),maxInputPaintMs:Math.max(...report.events.map(e=>e.inputPaintMs)),burst,timings:report.timings},null,2));
  }finally{await browser.close();}
}
await writeFile(process.env.REPORT??'artifacts/editor-find-performance.json',JSON.stringify(reports,null,2)+'\n');
for(const report of reports){
  assert.ok(Math.max(...report.events.map(event=>event.handlerMs))<Number(process.env.MAX_INPUT_MS??32),'Search must not block typing for a long task');
  assert.ok(report.burst.maxDispatchDelayMs<50,'Scheduled keystrokes must not wait behind a search long task');
}
