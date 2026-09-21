import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const browser=await chromium.launch();

try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/editor.html');

 const result=await page.evaluate(async()=>{
  const {importHtml}=await import('/src/extensions/html.ts');
  const {demoDocumentCodec}=await import('/src/extensions/demo-schema.ts');
  const nodes=importHtml(await (await fetch('/samples/warbreaker.html')).text()).nodes;
  const trials=[];

  for(let i=0;i<4;i++){
   const start=performance.now(),encoded=demoDocumentCodec.encode(nodes),encodeMs=performance.now()-start;
   const jsonStart=performance.now(),saved=JSON.stringify(encoded),jsonMs=performance.now()-jsonStart;
   const decodeStart=performance.now(),restored=demoDocumentCodec.decode(JSON.parse(saved)),decodeMs=performance.now()-decodeStart;

   if(JSON.stringify(demoDocumentCodec.encode(restored))!==saved)throw new Error('Book codec round trip changed content');

   if(i)trials.push({encodeMs,jsonMs,decodeMs,bytes:new TextEncoder().encode(saved).length});
  }

  return {recordedAt:new Date().toISOString(),blocks:nodes.length,method:'One warm-up, three serial trials; decode includes JSON.parse; Chromium development server',trials};
 });

 assert.ok(result.blocks>7000);await mkdir('artifacts/schema-codecs',{recursive:true});await writeFile('artifacts/schema-codecs/book.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
