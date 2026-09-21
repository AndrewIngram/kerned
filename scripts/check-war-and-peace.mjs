import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const base=process.env.EDITOR_URL??'http://127.0.0.1:5176/editor.html';
const html=await readFile('public/samples/war-and-peace.html','utf8');
const manifest=JSON.parse(await readFile('public/samples/war-and-peace.json','utf8'));
const source=await readFile(`public/samples/${manifest.fullHtml}`);
const digest=data=>createHash('sha256').update(data).digest('hex');
assert.equal(digest(html),manifest.htmlSha256);assert.equal(digest(source),manifest.sourceSha256);
const results=[];
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
  const browser=await type.launch();
  try{
    const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[],requests=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
    const url=new URL(base);url.pathname='/editor.html';url.search='sample=war-and-peace&paused=1';
    const start=Date.now();
    await page.goto(url.href);await page.waitForFunction(()=>window.editorDiagnostics);
    const initialLoadMs=Date.now()-start;
    const origin=await page.evaluate(()=>performance.timeOrigin);
    const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const picker=page.getByLabel('Sample',{exact:true});
    assert.equal(await picker.inputValue(),'war-and-peace');
    assert.equal(await page.evaluate(()=>window.editorDiagnostics.probe([]).count),32);
    await page.getByRole('button',{name:'Open document outline',exact:true}).focus();
    assert.equal(await page.locator('.outline-items button').count(),manifest.headings);
    assert.ok(await page.locator('.outline-items button:disabled').count()>350);
    await page.keyboard.press('Escape');

    const first=await page.evaluate(()=>window.editorDiagnostics.probe([3]).nodes[0]);
    await page.evaluate(()=>window.editorDiagnostics.select(3,0));await settle();
    await page.keyboard.type('Edited ');await settle();
    await page.evaluate(()=>window.editorDiagnostics.resume());
    await page.waitForFunction(()=>window.editorDiagnostics.probe([]).complete,null,{timeout:90000});await settle();
    assert.equal(await page.evaluate(()=>window.editorDiagnostics.probe([3]).nodes[0].text),'Edited '+first.text);
    await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();
    assert.deepEqual(await page.evaluate(()=>window.editorDiagnostics.probe([3]).nodes[0]),first);
    const fidelity=await page.evaluate(html=>{
      const template=document.createElement('template');template.innerHTML=html;
      for(const br of template.content.querySelectorAll('br'))br.replaceWith(document.createTextNode('\n'));
      const normal=text=>text.replace(/\s+/g,' ').trim(),compact=text=>text.replace(/\s/g,'');
      const expected=[...template.content.querySelectorAll('p,h2,h3')];
      const nodes=window.editorDiagnostics.read().nodes;
      const mismatches=expected.flatMap((element,i)=>{
        const node=nodes[i],level=element.tagName==='H2'?2:element.tagName==='H3'?3:undefined;
        return node&&normal(node.text)===normal(element.textContent)&&node.kind===(level?'heading':'paragraph')&&node.level===level?[]:[i];
      });
      const italic=nodes.flatMap(node=>node.marks.filter(span=>(span.mark.type==='italic')).map(span=>node.text.slice(span.from,span.to))).join('');
      const expectedItalic=[...template.content.querySelectorAll('em')].map(element=>element.textContent).join('');
      const passages=[...template.content.querySelectorAll('.preformatted')].map(element=>normal(element.textContent));
      return {count:nodes.length,mismatches,italicVerified:compact(italic)===compact(expectedItalic),linesVerified:passages.every(text=>nodes.find(node=>normal(node.text)===text)?.text.includes('\n')),words:nodes.map(node=>node.text).join(' ').split(/\s+/).length,last:nodes.at(-1).id,lastText:nodes.at(-1).text};
    },html);
    assert.equal(fidelity.count,manifest.blocks);assert.deepEqual(fidelity.mismatches,[]);
    assert.equal(fidelity.words,manifest.words);assert.equal(fidelity.italicVerified,true);assert.equal(fidelity.linesVerified,true);
    await page.screenshot({path:`artifacts/war-and-peace-${name}.png`});
    await page.getByRole('button',{name:'Open document outline',exact:true}).focus();
    await page.locator('.outline-items button').last().click();await settle();
    assert.ok(await page.evaluate(()=>scrollY>10000));
    await page.keyboard.press('Escape');
    await page.evaluate(id=>window.editorDiagnostics.scrollTo(id),fidelity.last);await settle();
    await page.evaluate(id=>window.editorDiagnostics.select(id,0),fidelity.last);await page.keyboard.type('Last page. ');await settle();
    assert.equal(await page.evaluate(id=>window.editorDiagnostics.probe([id]).nodes[0].text,fidelity.last),'Last page. '+fidelity.lastText);
    await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();
    assert.equal(await page.evaluate(id=>window.editorDiagnostics.probe([id]).nodes[0].text,fidelity.last),fidelity.lastText);
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>window.editorDiagnostics.probe([]).reflowPending===0,null,{timeout:90000});await settle();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:`artifacts/war-and-peace-${name}-narrow.png`});
    const metrics=await page.evaluate(()=>window.editorDiagnostics.metrics());assert.equal(metrics.stalePaints,0);

    // Each book has its own cached source, and sample edits never mutate that source.
    await picker.selectOption('warbreaker');
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('sample')==='warbreaker'&&document.querySelector('select[aria-label="Sample"]')?.disabled===false&&window.editorDiagnostics.probe([1]).nodes[0]?.text!=='BOOK ONE: 1805');
    await picker.selectOption('war-and-peace');
    await page.waitForFunction(()=>window.editorDiagnostics.probe([1]).nodes[0]?.text==='BOOK ONE: 1805');
    assert.deepEqual(await page.evaluate(()=>window.editorDiagnostics.probe([3]).nodes[0]),first);
    await picker.selectOption('minimal');await page.waitForFunction(()=>window.editorDiagnostics.probe([]).count===4);
    await page.goBack();await page.waitForFunction(()=>window.editorDiagnostics.probe([1]).nodes[0]?.text==='BOOK ONE: 1805');
    assert.equal(await page.evaluate(()=>performance.timeOrigin),origin);
    assert.equal(requests.filter(url=>url.endsWith('/samples/war-and-peace.html')).length,1);
    assert.equal(requests.filter(url=>url.endsWith('/samples/warbreaker.html')).length,1);
    assert.deepEqual(errors,[]);
    results.push({browser:name,blocks:fidelity.count,words:fidelity.words,headings:manifest.headings,italicVerified:true,initialLoadMs,elapsedIncludingPausedEditsMs:Math.round(metrics.completedAt-metrics.startedAt),stalePaints:metrics.stalePaints});
    console.log(results.at(-1));
    await page.close();

    const editor=await browser.newPage();
    url.pathname='/extensions.html';url.search='sample=war-and-peace&paused=1';
    await editor.goto(url.href);await editor.waitForFunction(()=>window.editorDiagnostics);
    assert.equal(await editor.getByLabel('Sample').inputValue(),'war-and-peace');
    await editor.getByRole('heading',{name:'War and Peace',exact:true}).waitFor();
    assert.equal(await editor.evaluate(()=>window.editorDiagnostics.probe([]).count),32);
    await editor.close();
  }finally{await browser.close();}
}
await writeFile('artifacts/war-and-peace-checks.json',JSON.stringify({htmlSha256:manifest.htmlSha256,results},null,2)+'\n');
