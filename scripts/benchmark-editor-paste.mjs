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
    await page.goto('http://127.0.0.1:5173/editor.html?sample=warbreaker');
    await page.waitForFunction(()=>window.editorDiagnostics?.probe([]).complete);
    const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const input=page.locator('.text-capture');
    await page.evaluate(()=>window.editorDiagnostics.select(1,0));await page.keyboard.press('ControlOrMeta+a');await settle();
    let cdp;
    if(process.env.PROFILE&&name==='chromium'){cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
    const copy=await input.evaluate(el=>{
      const event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});
      const started=performance.now();el.dispatchEvent(event);const copyMs=performance.now()-started;
      const data=event.clipboardData;
      window.pasteBenchmark={data:Object.fromEntries([...data.types].map(type=>[type,data.getData(type)])),html:data.getData('text/html'),nodes:window.editorDiagnostics.read().nodes};
      return {copyMs,characters:data.getData('text/plain').length,blocks:window.pasteBenchmark.nodes.length};
    });
    assert.ok(copy.characters>1_000_000);
    await page.evaluate(()=>{const last=window.editorDiagnostics.read().nodes.at(-1);window.editorDiagnostics.select(last.id,last.text.length);});await settle();
    const paste=await input.evaluate(async el=>{
      // Populate the synthetic clipboard before timing application event work.
      const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});
      for(const [type,value] of Object.entries(window.pasteBenchmark.data))event.clipboardData.setData(type,value);
      const before=window.editorDiagnostics.metrics().layoutCalls,started=performance.now();
      let previous=started,maxFrameGapMs=0;
      function frame(){
        const now=performance.now();
        maxFrameGapMs=Math.max(maxFrameGapMs,now-previous);previous=now;
        window.pasteBenchmark.maxFrameGapMs=maxFrameGapMs;
        if(window.editorDiagnostics.probe([]).reflowPending)requestAnimationFrame(frame);
        else window.pasteBenchmark.completeMs=performance.now()-started;
      }
      requestAnimationFrame(frame);
      el.dispatchEvent(event);const handlerMs=performance.now()-started;
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return {handlerMs,paintMs:performance.now()-started,layoutsToPaint:window.editorDiagnostics.metrics().layoutCalls-before,blocks:window.editorDiagnostics.read().nodes.length};
    });
    if(cdp){const {profile}=await cdp.send('Profiler.stop');await writeFile(process.env.PROFILE,JSON.stringify(profile));}
    assert.equal(await page.locator('.input-notice').innerText(),'');
    await page.waitForFunction(()=>!window.editorDiagnostics.probe([]).reflowPending,null,{timeout:30000});
    const background=await page.evaluate(()=>({completeMs:window.pasteBenchmark.completeMs,maxFrameGapMs:window.pasteBenchmark.maxFrameGapMs,stalePaints:window.editorDiagnostics.metrics().stalePaints}));
    await page.keyboard.press('ControlOrMeta+a');await settle();
    const doubled=await input.evaluate(el=>{
      const event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});el.dispatchEvent(event);
      return event.clipboardData.getData('text/html')===window.pasteBenchmark.html.repeat(2);
    });
    assert.ok(doubled,'Paste at the end must duplicate every block and supported mark');
    await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();
    assert.equal(await page.evaluate(()=>window.editorDiagnostics.read().nodes.length),copy.blocks,'One undo removes the whole paste');
    await page.getByRole('button',{name:'Redo',exact:true}).click();await settle();
    assert.equal(await page.evaluate(()=>window.editorDiagnostics.read().nodes.length),copy.blocks*2,'One redo restores the whole paste');
    assert.deepEqual(errors,[]);
    assert.equal(background.stalePaints,0);
    const report={browser:name,...copy,originalBlocks:copy.blocks,...paste,...background};reports.push(report);console.log(JSON.stringify(report));
  }finally{await browser.close();}
}
await writeFile(process.env.REPORT??'artifacts/editor-paste-performance.json',JSON.stringify(reports,null,2)+'\n');
for(const report of reports){
  assert.ok(report.handlerMs<Number(process.env.MAX_HANDLER_MS??200),'Pasting a book must not monopolize the input task');
  assert.ok(report.paintMs<Number(process.env.MAX_PAINT_MS??250),'Pasted text must reach a frame without laying out the whole book');
}
