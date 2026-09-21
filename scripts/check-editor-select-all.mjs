import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';

for(const name of (process.env.BROWSERS??'chromium,firefox,webkit').split(',')){
  const browser=await {chromium,firefox,webkit}[name].launch();

  try{
    const page=await browser.newPage({viewport:{width:1100,height:900}});
    await page.routeWebSocket(url=>url.pathname==='/',()=>{});
    await page.goto('http://127.0.0.1:5173/editor.html');await page.waitForFunction(()=>window.editorDiagnostics);

    const result=async label=>{
      await page.keyboard.press('Meta+a');
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

      return page.evaluate(label=>{
        const state=window.editorDiagnostics.read(),last=state.nodes.at(-1),selection=state.selection;

        return {label,focus:document.activeElement?.getAttribute('aria-label')??document.activeElement?.tagName,selection,selectedAll:selection.anchorId===state.nodes[0].id&&selection.anchor===0&&selection.id===last.id&&selection.focus===last.text.length};
      },label);
    };

    const cases=[await result('fresh page')];
    const canvas=await page.getByLabel('Canvas document').boundingBox();
    await page.mouse.click(canvas.x+90,canvas.y+48);cases.push(await result('clicked text'));
    await page.evaluate(()=>window.editorDiagnostics.select(1,3));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    // Safari's native Edit > Select All can select the capture textarea without
    // delivering the Cmd-A keydown that headless keyboard helpers synthesize.
    await page.getByLabel('Canvas text input').evaluate(el=>el.select());
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const native=await page.evaluate(()=>window.editorDiagnostics.read().selection);
    assert.equal(native.id,4,'Native Select All must expand from the capture paragraph to the document');
    await page.evaluate(()=>window.editorDiagnostics.select(1,0));
    await page.getByLabel('Sample',{exact:true}).selectOption('warbreaker');await page.waitForFunction(()=>window.editorDiagnostics?.probe([]).complete);
    cases.push(await result('sample picker'));
    // Native controls select their own text without changing the document range.
    await page.getByRole('button',{name:'Find',exact:true}).click();
    const find=page.getByRole('textbox',{name:'Find in document',exact:true});await find.fill('Breath');
    const beforeFind=await page.evaluate(()=>window.editorDiagnostics.read().selection);
    await find.press('Meta+a');
    assert.deepEqual(await find.evaluate(el=>[el.selectionStart,el.selectionEnd]),[0,6]);
    assert.deepEqual(await page.evaluate(()=>window.editorDiagnostics.read().selection),beforeFind);
    await find.press('Escape');await page.evaluate(()=>window.editorDiagnostics.select(1,0));
    await page.keyboard.press('Control+a');
    assert.ok((await result('Ctrl-A and Cmd-A')).selectedAll);
    console.log(JSON.stringify({browser:name,cases}));
    assert.ok(cases.every(row=>row.selectedAll),'Cmd-A must select the document from the page, canvas, and sample toolbar');
  }finally{await browser.close();}
}
