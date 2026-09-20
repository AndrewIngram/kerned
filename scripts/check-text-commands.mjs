import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/editor.html');await page.waitForFunction(()=>window.hybridSpike);
  const result=await page.evaluate(async()=>{
   const {textCommands}=await import('/src/extensions/text-commands.ts');
   const {createEditor,TextSelection}=await import('/src/editor/index.ts');
   const {demoSchema}=await import('/src/extensions/demo-schema.ts');
   const nodes=[1,2].map(id=>({kind:'paragraph',id,key:`p${id}`,text:'Alpha beta gamma',spans:[{start:0,end:16,bold:true,italic:true}],atoms:[],comments:[]}));
   const selection=new TextSelection({id:1,offset:6},{id:2,offset:10});
   const editor=createEditor(demoSchema,nodes,selection);
   const apply=steps=>editor.dispatch({baseRevision:editor.state.revision,origin:'local',history:'separate',time:performance.now(),steps});
   apply(textCommands(demoSchema,editor.state).toggle('underline'));
   const underline=editor.state.nodes.every(n=>n.spans.some(s=>s.underline));
   const unchanged=editor.state.selection.eq(selection);
   apply(textCommands(demoSchema,editor.state).clear());
   const cleared=editor.state.nodes[0].spans.every(s=>s.end<=6)&&editor.state.nodes[1].spans.every(s=>s.start>=10);
   editor.undo();const restored=textCommands(demoSchema,editor.state).active('underline');
   const comment=textCommands(demoSchema,editor.state).comment('discussion');apply(comment.steps);
   const annotations=editor.state.nodes.map(n=>n.comments[0]);
   editor.undo();const removed=editor.state.nodes.every(n=>n.comments.length===0);
   editor.redo();const recovered=editor.state.nodes.every(n=>n.comments[0]?.id==='discussion');
   return {underline,unchanged,cleared,restored,annotations,removed,recovered};
  });
  for(const key of ['underline','unchanged','cleared','restored','removed','recovered'])assert.equal(result[key],true,key);
  assert.deepEqual(result.annotations.map(c=>[c.start,c.end]),[[6,16],[0,10]]);
  console.log(name,'underline, clear formatting, cross-paragraph comments and undo/redo passed');
 }finally{await browser.close();}
}
