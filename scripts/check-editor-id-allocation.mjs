import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch();

try{
  const page=await browser.newPage();
  await page.routeWebSocket(url=>url.pathname==='/',()=>{});
  await page.goto('http://127.0.0.1:5173/editor.html');

  const result=await page.evaluate(async()=>{
    const {createEditor,createSchema,textSelection}=await import('/src/editor/index.ts');
    let visits=0;

    const schema=createSchema([
      {name:'text',version:1,kind:'text',accepts:n=>n.kind==='text',validateUpdate(){},editing:{text:n=>n.text,replace:(n,from,to,text)=>({...n,text:n.text.slice(0,from)+text+n.text.slice(to)}),split:(n,at,right)=>[{...n,text:n.text.slice(0,at)},{...n,...right,text:n.text.slice(at)}],join:(a,b)=>({...a,text:a.text+b.text})}},
      {name:'group',version:1,kind:'container',accepts:n=>n.kind==='group',validateUpdate(){},content:{children:n=>n.children,withChildren:(n,children)=>({...n,children}),validateChildren(){}}},
    ]);

    const counted={...schema,resolve(node){visits++;

return schema.resolve(node);}};

    const leaf=id=>({id,key:`p-${id}`,kind:'text',text:'Text'});
    const initial=[leaf(1),{id:2,key:'group',kind:'group',children:[leaf(-1),leaf(-3)]},...Array.from({length:400},(_,i)=>leaf(i+3))];
    const editor=createEditor(counted,initial,textSelection(1,0));
    visits=0;const ids=Array.from({length:400},()=>editor.allocateBlockId()),allocationVisits=visits;
    const existing=new Set([1,2,-1,-3,...initial.slice(2).map(n=>n.id)]);
    const unique=ids.every(id=>!existing.has(id))&&new Set(ids).size===ids.length;
    editor.select(textSelection(1,2));visits=0;editor.allocateBlockId();const selectionVisits=visits;
    const collision=editor.allocateBlockId()-1;
    editor.dispatch({baseRevision:editor.state.revision,origin:'stream',history:'exclude',steps:[{kind:'append',nodes:[leaf(collision)]}]});
    const afterStream=editor.allocateBlockId();
    editor.dispatch({baseRevision:editor.state.revision,origin:'local',history:'separate',time:0,steps:[{kind:'insertChildren',parent:2,index:0,nodes:[leaf(afterStream-1)]}]});
    const afterInsert=editor.allocateBlockId();
    editor.undo();const afterUndo=editor.allocateBlockId();editor.redo();const afterRedo=editor.allocateBlockId();

    return {allocationVisits,selectionVisits,unique,avoidedStream:afterStream!==collision,avoidedNested:afterInsert!==afterStream-1,monotonic:afterRedo<afterUndo&&afterUndo<afterInsert};
  });

  console.log(JSON.stringify(result));
  assert.ok(result.unique&&result.avoidedStream&&result.avoidedNested&&result.monotonic,'Allocation must stay collision-free across nested edits, stream arrivals and history');
  assert.ok(result.allocationVisits<1000,'Allocating many IDs must scan the document at most once');
  assert.equal(result.selectionVisits,0,'Selection changes must not invalidate the ID cache');
}finally{await browser.close();}
