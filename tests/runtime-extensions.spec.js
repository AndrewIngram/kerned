import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{await page.goto('/editor.html');await page.waitForFunction(()=>window.editorDiagnostics);});

test('React selectors suppress unchanged values and view listeners clean up under StrictMode',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {fixture,dispatch,mountOptimizedProbe}=await import('/tests/fixtures/editor-foundation.js');
  const {textSelection}=await import('/src/editor/index.ts');
  const editor=fixture(),element=document.createElement('div');document.body.append(element);
  const probe=await mountOptimizedProbe(editor,element),before={...probe.counts};
  probe.flush(()=>editor.select(textSelection(3,1)));
  const same={...probe.counts};
  probe.flush(()=>dispatch(editor,[{kind:'replaceText',id:3,from:0,to:0,text:'!'}]));
  const changed={...probe.counts};
  const input=element.querySelector('textarea'),surface=element.firstElementChild;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  element.querySelector('button').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
  const interactive=probe.counts.pointer;
  surface.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));
  const pointer=probe.counts.pointer;
  probe.unmount();surface.append(input);input.dispatchEvent(new Event('input',{bubbles:true}));
  surface.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));
  element.remove();

return {before,same,changed,interactive,pointer,final:probe.counts};
 });

 expect(result.same.revision).toBe(result.before.revision);expect(result.same.selection).toBe(result.before.selection);
 expect(result.changed.revision).toBeGreaterThan(result.same.revision);expect(result.changed.selection).toBe(result.same.selection);
 expect(result.interactive).toBe(0);expect(result.pointer).toBe(1);expect(result.final.pointer).toBe(1);expect(result.final.input).toBe(1);
});

test('extension state publishes atomically and commands report mixed state without running effects',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {fixture}=await import('/tests/fixtures/editor-foundation.js');
  const {createStateField,commandActivity}=await import('/src/editor/index.ts');

  const field=createStateField({create:()=>({edits:0,restores:0}),update:(value,event)=>{
   if(event.kind==='transaction'&&event.transaction.steps.some(step=>step.text==='reject'))throw new Error('rejected by extension');

   return {edits:value.edits+(event.kind==='transaction'?1:0),restores:value.restores+(['undo','redo'].includes(event.kind)?1:0)};
  }});

  const editor=fixture({fields:[field]});let effects=0,seen=[];editor.subscribe(()=>seen.push(field.read(editor.state)));

  const command={execute(context,text){context.step({kind:'replaceText',id:3,from:0,to:0,text});context.effect(()=>effects++);

return true;},activity:()=>commandActivity([true,false])};

  const query=editor.commandState(command,'x'),untouched=field.read(editor.state),failed=editor.chain().command(command,'x').command(()=>false).run();
  editor.chain().command(command,'x').run();const committed=field.read(editor.state);editor.undo();editor.redo();
  const before=editor.state,checkpoint=JSON.stringify(editor.positions.checkpoint()),history=editor.history;let rejected=false;

  try{editor.chain().command(command,'reject').run();}catch{rejected=true;}

  return {query,untouched,failed,effects,committed,seen,rejected,same:editor.state===before,checkpoint:checkpoint===JSON.stringify(editor.positions.checkpoint()),history:JSON.stringify(history)===JSON.stringify(editor.history)};
 });

 expect(result.query).toEqual({available:true,activity:'mixed'});expect(result.untouched).toEqual({edits:0,restores:0});expect(result.failed).toBe(false);
 expect(result.effects).toBe(1);expect(result.committed).toEqual({edits:1,restores:0});expect(result.seen).toEqual([{edits:1,restores:0},{edits:1,restores:1},{edits:1,restores:2}]);
 expect(result.rejected&&result.same&&result.checkpoint&&result.history).toBe(true);
});

test('serialized structural references follow wrapping and movement and recover on undo or reload',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {fixture,dispatch,schema}=await import('/tests/fixtures/editor-foundation.js');
  const {createEditor,parseRelativeGap}=await import('/src/editor/index.ts');
  const editor=fixture({documentId:'gaps'}),ref=parseRelativeGap(JSON.parse(JSON.stringify(editor.positions.before(4))));
  const at=()=>editor.positions.resolveGap(ref);
  const original=at();dispatch(editor,[{kind:'wrapChildren',parent:2,index:0,count:2,wrapper:{id:100,key:'wrap',kind:'group',role:'quote',children:[]}}]);const wrapped=at();
  dispatch(editor,[{kind:'moveChildren',parent:100,index:1,count:1,toParent:16,toIndex:0}]);const moved=at();
  dispatch(editor,[{kind:'removeChildren',parent:16,index:0,count:1}]);const fallback=at();
  dispatch(editor,[{kind:'removeChildren',parent:100,index:0,count:1}]);const deleted=at();editor.undo();editor.undo();const undone=at();
  const reloaded=createEditor(schema,structuredClone(editor.state.nodes),editor.state.selection,[],{documentId:'gaps'}).positions.resolveGap(ref);
  const other=fixture({documentId:'other'}).positions.resolveGap(ref);

  return {original,wrapped,moved,fallback,deleted,undone,reloaded,other};
 });

 expect(result.original).toEqual({status:'resolved',gap:{parent:2,index:1}});expect(result.wrapped).toEqual({status:'resolved',gap:{parent:100,index:1}});
 expect(result.moved).toEqual({status:'resolved',gap:{parent:16,index:0}});expect(result.fallback).toEqual({status:'resolved',gap:{parent:100,index:1}});
 expect(result.deleted).toEqual({status:'deleted'});expect(result.undone).toEqual(result.moved);expect(result.reloaded).toEqual(result.moved);
 expect(result.other).toEqual({status:'unavailable',reason:'document-mismatch'});
});

test('mark extensions control caret boundary inheritance independently of rendering',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {createMarkSchema,createSchema,marksAt}=await import('/src/editor/index.ts');
  const marks=createMarkSchema([{name:'link',version:1,parse:value=>value,inclusiveStart:false,inclusiveEnd:false},{name:'highlight',version:1,parse:value=>value,inclusiveStart:true,inclusiveEnd:true}]);
  const node={id:1,key:'p',text:'abcde',ranges:[{from:1,to:3,mark:marks.create('link','url')},{from:1,to:3,mark:marks.create('highlight','gold')}]};
  const schema=createSchema([{name:'text',version:1,kind:'text',accepts:()=>true,validateUpdate(){},editing:{text:n=>n.text,marks:{read:n=>n.ranges,boundary:marks.boundary},replace(){},split(){},join(){}}}]);

  return [0,1,2,3,4].map(offset=>marksAt(schema,node,offset).map(mark=>mark.type));
 });

 expect(result).toEqual([[],['highlight'],['link','highlight'],['highlight'],[]]);
});

test('gap association distinguishes insertions, empty containers and deleted parents',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {fixture,dispatch}=await import('/tests/fixtures/editor-foundation.js');
  const {parseRelativeGap}=await import('/src/editor/index.ts');const editor=fixture();
  const left=editor.positions.gap(2,1,-1),right=editor.positions.gap(2,1,1),emptyLeft=editor.positions.gap(16,0,-1),emptyRight=editor.positions.gap(16,0,1);
  dispatch(editor,[{kind:'insertChildren',parent:2,index:1,nodes:[{id:100,key:'new',kind:'text',value:'new'}]},{kind:'insertChildren',parent:16,index:0,nodes:[{id:101,key:'empty-child',kind:'text',value:'new'}]}]);
  const inserted=[left,right,emptyLeft,emptyRight].map(editor.positions.resolveGap);
  dispatch(editor,[{kind:'removeChildren',parent:null,index:2,count:1}]);const deleted=editor.positions.resolveGap(emptyRight);
  let malformed=false;

try{parseRelativeGap({...left,association:0});}catch{malformed=true;}

  return {inserted,deleted,malformed};
 });

 expect(result.inserted).toEqual([{status:'resolved',gap:{parent:2,index:1}},{status:'resolved',gap:{parent:2,index:2}},{status:'resolved',gap:{parent:16,index:0}},{status:'resolved',gap:{parent:16,index:1}}]);
 expect(result.deleted).toEqual({status:'deleted'});expect(result.malformed).toBe(true);
});

test('foreign inline extensions own attributes, layout and versioned serialization',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {createInlineSchema,jsonRecord,jsonString,replaceInlineObjects,sliceInlineObjects}=await import('/src/editor/index.ts');
  const values=createInlineSchema([{name:'equation',version:3,parse(raw){return {formula:jsonString(jsonRecord(raw).formula)};},plainText:attrs=>attrs.formula,layout:value=>({label:value.attrs.formula,width:20})}]);
  const value=values.create('equation','eq',1,{formula:'a+b'}),encoded=values.encode([value]);
  const restored=values.decode('x\ufffcy',JSON.parse(JSON.stringify(encoded)));
  const moved=replaceInlineObjects(restored,0,0,2),sliced=sliceInlineObjects(moved,3,4);
  let invalid=false;

try{values.decode('x\ufffcy',[{...encoded[0],version:2}]);}catch{invalid=true;}

  return {restored,layout:values.layout(value),text:values.plainText(value),moved:moved[0].index,sliced:sliced[0].index,invalid};
 });

 expect(result.restored).toEqual([{type:'equation',id:'eq',index:1,attrs:{formula:'a+b'}}]);expect(result.layout).toEqual({label:'a+b',width:20});expect(result.text).toBe('a+b');expect(result.moved).toBe(3);expect(result.sliced).toBe(0);expect(result.invalid).toBe(true);
});

test('mark command queries cover partial text and caret chains reset on movement',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {createEditor,textSelection,toggleMarkCommand}=await import('/src/editor/index.ts');
  const {demoSchema}=await import('/src/extensions/demo-schema.ts');
  let editable=true;const bold={type:'bold',attrs:null};
  const editor=createEditor(demoSchema,[{kind:'paragraph',id:1,key:'p',text:'abcdef',marks:[{from:0,to:2,mark:bold}],inline:[]}],textSelection(1,0,6),[],{permissions:{access:()=>editable?'editable':'read-only'}});
  const command=toggleMarkCommand(demoSchema,bold),mixed=editor.commandState(command);
  const run=editor.chain().command(command).run(),active=editor.commandState(command);
  editable=false;const blocked=editor.commandState(command);editable=true;
  editor.select(textSelection(1,2));const caretBefore=editor.state.revision;
  editor.chain().storedMarks([]).run();const unchanged=editor.state.revision===caretBefore;
  const moved=editor.chain().storedMarks([bold]).select(textSelection(1,3,5)).run();

  return {mixed,run,active,blocked,unchanged,moved,stored:editor.state.storedMarks};
 });

 expect(result.mixed).toEqual({available:true,activity:'mixed'});expect(result.run).toBe(true);expect(result.active).toEqual({available:true,activity:'active'});
 expect(result.blocked).toEqual({available:false,activity:'active'});expect(result.unchanged&&result.moved).toBe(true);expect(result.stored).toBe(null);
});

test('framework-free text capture handles a foreign schema and nested selection',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {fixture,schema}=await import('/tests/fixtures/editor-foundation.js');
  const {TextSelection,textSelection}=await import('/src/editor/index.ts');
  const {createTextInput}=await import('/src/editor-browser/index.ts');
  const editor=fixture(),input=document.createElement('textarea'),capture=createTextInput(schema,editor);document.body.append(input);
  let all=0;const dispose=capture.mount(input,()=>all++),changes=[];
  editor.select(textSelection(3,2,5));capture.sync(input);const selected=[input.value,input.selectionStart,input.selectionEnd];
  input.value='AlX 😀 beta';capture.read(input,(...args)=>changes.push(args));
  editor.select(new TextSelection({id:15,offset:1},{id:8,offset:0}));capture.sync(input);input.value='replacement';capture.read(input,(...args)=>changes.push(args));
  capture.compositionStart();const composing=capture.composing;capture.compositionEnd(input);dispose();const ended=!capture.composing;
  input.dispatchEvent(new Event('select'));input.remove();

return {selected,changes,composing,ended,all};
 });

 expect(result.selected).toEqual(['Alpha 😀 beta',2,5]);expect(result.changes).toEqual([[2,5,'X'],[0,0,'replacement']]);expect(result.composing&&result.ended).toBe(true);expect(result.all).toBe(0);
});

test('selection projection and multiclick ranges work with a foreign schema',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {createSchema,indexTree,selectionContext,selectionView,TextSelection,textSelectionAtClick}=await import('/src/editor/index.ts');
  const schema=createSchema([{name:'foreign',version:1,kind:'text',accepts:()=>true,validateUpdate(){},editing:{text:node=>node.body,replace:node=>node,split:node=>[node,node],join:node=>node}}]);
  const nodes=[{id:71,key:'one',body:'First words'},{id:99,key:'two',body:'Second sentence'}];
  const tree=indexTree(schema,nodes),context=selectionContext(schema,nodes,tree),indexes=new Map(nodes.map((node,index)=>[node.id,index]));
  const forward=selectionView(schema,new TextSelection({id:71,offset:6},{id:99,offset:6}),context,indexes);
  const backward=selectionView(schema,new TextSelection({id:99,offset:6},{id:71,offset:6}),context,indexes);
  const word=textSelectionAtClick(nodes[1].body,99,9,false,2),block=textSelectionAtClick(nodes[1].body,99,9,false,3);

  return {forward:nodes.map(forward.selectedRange),backward:nodes.map(backward.selectedRange),word:[word.anchor,word.head],block:[block.anchor,block.head],single:textSelectionAtClick(nodes[0].body,71,4,false,1)};
 });

 expect(result.forward).toEqual([{from:6,to:11},{from:0,to:6}]);
 expect(result.backward).toEqual(result.forward);
 expect(result.word).toEqual([{id:99,offset:7},{id:99,offset:15}]);
 expect(result.block).toEqual([{id:99,offset:0},{id:99,offset:15}]);
 expect(result.single).toBeNull();
});
