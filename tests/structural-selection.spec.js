import {test,expect} from '@playwright/test';

test('structural ranges preserve direction, hierarchy, codecs and transaction history',async({page})=>{
 await page.goto('/editor.html');await page.waitForFunction(()=>window.hybridSpike);
 const result=await page.evaluate(async()=>{
  const {schema}=await import('/tests/fixtures/editor-foundation.js');
  const {createEditor,RangeSelection,selectionContext,createSelectionRegistry,extendSelection}=await import('/src/editor/index.ts');
  const atom=id=>({id,key:`n-${id}`,kind:'atom'}),text=(id,value)=>({id,key:`n-${id}`,kind:'text',value});
  const nodes=[atom(1),text(2,'Middle'),{id:3,key:'n-3',kind:'group',children:[atom(4),text(5,'Tail')]},atom(6)];
  const context=selectionContext(schema,nodes),anchor={kind:'node',id:1,side:'before'},head={kind:'text',id:5,offset:2};
  const selection=new RangeSelection(anchor,head),backward=new RangeSelection(head,anchor);
  const ranges=selection.ranges(context),reverse=backward.ranges(context);
  const remap=node=>({...node,id:node.id+100,...(node.children?{children:node.children.map(remap)}:{})});
  const restored=createSelectionRegistry().read(selectionContext(schema,nodes.map(remap)),selection.encode(context));
  const editor=createEditor(schema,nodes,selection);
  const edit=editor.selectionEdit('X');editor.dispatch({baseRevision:0,origin:'local',history:'separate',time:0,...edit});
  const after=editor.state.nodes;
  editor.undo();const undo=editor.state.selection.eq(selection)&&JSON.stringify(editor.state.nodes)===JSON.stringify(nodes);
  editor.redo();const redo=JSON.stringify(editor.state.nodes)===JSON.stringify(after);
  const whole=new RangeSelection({kind:'node',id:4,side:'before'},{kind:'node',id:5,side:'after'}).ranges(context);
  const edges=extendSelection({kind:'node-selection',id:6},{kind:'node-selection',id:1},context);
  let rejected=false;try{createSelectionRegistry().read(context,{type:'range',version:1,data:{anchor:{kind:'node',key:'n-1',side:'inside'},head,upstream:false}});}catch{rejected=true;}
  return {ranges,reverse,restored:restored.anchor,after,undo,redo,whole,edges:edges.ranges(context),rejected};
 });
 expect(result.ranges).toEqual([{kind:'node',id:1},{kind:'node',id:2},{kind:'node',id:4},{kind:'text',id:5,from:0,to:2}]);
 expect(result.reverse).toEqual(result.ranges);
 expect(result.restored).toEqual({kind:'node',id:101,side:'before'});
 expect(result.after).toEqual([{id:3,key:'n-3',kind:'group',children:[{id:5,key:'n-5',kind:'text',value:'Xil'}]},{id:6,key:'n-6',kind:'atom'}]);
 expect(result.undo&&result.redo&&result.rejected).toBe(true);
 expect(result.whole).toEqual([{kind:'node',id:3}]);
 expect(result.edges).toEqual([{kind:'node',id:1},{kind:'node',id:2},{kind:'node',id:3},{kind:'node',id:6}]);
});

test('dragging from an image and shift-clicking it creates a usable structural selection',async({page})=>{
 await page.goto('/hybrid-editor.html?stream=32');await page.waitForFunction(()=>window.hybridSpike);
 const setup=await page.evaluate(()=>{
  const nodes=window.hybridSpike.read().nodes,index=nodes.findIndex(n=>n.kind==='image');
  window.hybridSpike.scrollTo(nodes[index].id);
  return {image:nodes[index].id,before:nodes[index-1].id,after:nodes[index+1].id};
 });
 const image=page.locator(`[data-image="${setup.image}"]`);await image.scrollIntoViewIfNeeded();
 await image.click();await page.keyboard.press('Shift+ArrowRight');
 expect(await page.evaluate(()=>window.hybridSpike.read().selection.type)).toBe('range');
 await page.keyboard.press('Shift+ArrowRight');
 expect(await page.evaluate(()=>window.hybridSpike.read().selection.type)).toBe('range');
 await page.keyboard.type('Replacement');
 expect(await page.evaluate(id=>window.hybridSpike.read().nodes.some(n=>n.id===id),setup.image)).toBe(false);
 const undo=process.platform==='darwin'?'Meta+z':'Control+z';
 // Typing the replacement and subsequent characters can occupy separate groups.
 for(let i=0;i<3&&!await page.evaluate(id=>window.hybridSpike.read().nodes.some(n=>n.id===id),setup.image);i++)await page.keyboard.press(undo);
 await expect(image).toBeVisible();
 await page.evaluate(id=>window.hybridSpike.scrollTo(id),setup.before);
 await page.evaluate(id=>window.hybridSpike.select(id,0),setup.before);
 await image.click({modifiers:['Shift']});
 expect(await page.evaluate(()=>window.hybridSpike.read().selection.type)).toBe('range');
 const bounds=await image.boundingBox();
 await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();
 await page.mouse.move(bounds.x+10,Math.max(110,bounds.y-25),{steps:8});await page.mouse.up();
 expect(await page.evaluate(()=>window.hybridSpike.read().selection.type)).toBe('range');
 const clipboard=await page.evaluate(async()=>{

  const event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()}),input=document.querySelector('.text-capture');input.dispatchEvent(event);const data=event.clipboardData;
  return {plain:data.getData('text/plain'),token:data.getData('application/x-gprose-fragment')};
 });
 expect(clipboard.token).not.toBe('');
 expect(clipboard.plain).toContain('Landscape illustration');
});

test('node edges follow split and join, and node-only ranges support replacement and gaps',async({page})=>{
 await page.goto('/editor.html');await page.waitForFunction(()=>window.hybridSpike);
 const result=await page.evaluate(async()=>{
  const {createEditor,RangeSelection,selectionContext}=await import('/src/editor/index.ts');
  const {demoSchema}=await import('/src/extensions/demo-schema.ts');
  const {pasteFragment}=await import('/src/extensions/clipboard.ts');
  const p=(id,text)=>({kind:'paragraph',id,key:`p-${id}`,text,marks:[],inline:[]});
  const image=id=>({kind:'image',id,key:`i-${id}`,src:'data:,',alt:'Image'});
  const editor=createEditor(demoSchema,[image(1),p(2,'abcdef'),image(3)],new RangeSelection({kind:'node',id:2,side:'before'},{kind:'node',id:2,side:'after'}));
  const dispatch=steps=>editor.dispatch({baseRevision:editor.state.revision,origin:'local',history:'separate',time:editor.state.revision,steps});
  dispatch([{kind:'split',id:2,at:3,rightId:4,rightKey:'p-4'}]);
  const split=editor.state.selection.encode(selectionContext(demoSchema,editor.state.nodes));
  dispatch([{kind:'join',left:2,right:4}]);const joined=editor.state.selection.head;
  editor.select(new RangeSelection({kind:'node',id:1,side:'before'},{kind:'node',id:1,side:'after'}));
  let next=10;const allocate=()=>({id:next++,key:crypto.randomUUID()});
  const command=pasteFragment(demoSchema,editor.state,{inline:false,nodes:[p(99,'replacement')]},allocate);
  editor.dispatch({baseRevision:editor.state.revision,origin:'local',history:'separate',time:10,...command});
  const replacement=editor.state.nodes.map(n=>n.kind==='paragraph'?n.text:n.kind);
  editor.select(new RangeSelection({kind:'node',id:3,side:'after'},{kind:'node',id:3,side:'after'}));
  const gap=pasteFragment(demoSchema,editor.state,{inline:false,nodes:[p(100,'after')]},allocate);
  editor.dispatch({baseRevision:editor.state.revision,origin:'local',history:'separate',time:11,...gap});
  return {split,joined,replacement,gap:editor.state.nodes.at(-1).text};
 });
 expect(result.split.data.head).toEqual({kind:'node',key:'p-4',side:'after'});
 expect(result.joined).toEqual({kind:'node',id:2,side:'after'});
 expect(result.replacement).toEqual(['replacement','abcdef','image']);
 expect(result.gap).toBe('after');
});

test('node-only document supports drag, shift reversal and document-edge extension',async({page})=>{
 await page.goto('/editor.html');await page.waitForFunction(()=>window.hybridSpike);
 await page.evaluate(async()=>{
  const {schema}=await import('/tests/fixtures/editor-foundation.js');
  const {createEditor,NodeSelection,selectionContext}=await import('/src/editor/index.ts');
  const {mountEditorView,createTextInteraction}=await import('/src/editor-browser/index.ts');
  const nodes=[{id:1,key:'one',kind:'atom'},{id:2,key:'two',kind:'atom'}],editor=createEditor(schema,nodes,new NodeSelection(1));
  const context=selectionContext(schema,nodes),interaction=createTextInteraction(),root=document.createElement('div');
  root.style.cssText='position:fixed;inset:100px 100px auto;z-index:100;background:white';
  root.innerHTML='<div data-atom="1" style="height:80px">One</div><div data-atom="2" style="height:80px">Two</div><textarea aria-label="Atom capture" style="position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01"></textarea>';
  document.body.append(root);const input=root.querySelector('textarea');let view;
  function options(){const binding=interaction.bind({selection:editor.state.selection,context,nodes:()=>nodes.map(n=>({id:n.id,text:null,selectable:true})),nodeAt:target=>Number(target.closest('[data-atom]')?.getAttribute('data-atom'))||null,select(selection){editor.select(selection);view.update(options());},breakHistory(){},focus(){input.focus({preventScroll:true});},reveal(){},point:()=>null,regions:()=>[],text:()=>null,blocks:()=>[],layout(){throw new Error('Atoms have no text layout');},viewportHeight:500});return {pointer:binding.pointer,input:{element:()=>input,keydown:binding.keydown}};}
  view=mountEditorView(root,options());window.atomProbe=()=>({type:editor.state.selection.type,ranges:editor.state.selection.ranges(context)});
 });
 await page.locator('[data-atom="1"]').click();await page.keyboard.press('Shift+ArrowRight');
 expect((await page.evaluate(()=>window.atomProbe())).ranges).toEqual([{kind:'node',id:1},{kind:'node',id:2}]);
 await page.keyboard.press('Shift+ArrowLeft');
 expect((await page.evaluate(()=>window.atomProbe())).ranges).toEqual([{kind:'node',id:1}]);
 await page.keyboard.press('Shift+ArrowRight');
 expect((await page.evaluate(()=>window.atomProbe())).ranges).toHaveLength(2);
 await page.locator('[data-atom="2"]').click();await page.keyboard.press('Control+Shift+Home');
 expect((await page.evaluate(()=>window.atomProbe())).ranges).toHaveLength(2);
 const one=await page.locator('[data-atom="1"]').boundingBox(),two=await page.locator('[data-atom="2"]').boundingBox();
 await page.mouse.move(two.x+20,two.y+40);await page.mouse.down();await page.mouse.move(one.x+20,one.y+40,{steps:6});await page.mouse.up();
 expect((await page.evaluate(()=>window.atomProbe())).ranges).toHaveLength(2);
});

test('structural edits clean empty containers and keep surviving endpoints when an ancestor is deleted',async({page})=>{
 await page.goto('/editor.html');await page.waitForFunction(()=>window.hybridSpike);
 const result=await page.evaluate(async()=>{
  const {createEditor,RangeSelection,selectionContext}=await import('/src/editor/index.ts');
  const {demoSchema}=await import('/src/extensions/demo-schema.ts');
  const {replaceStructuredText}=await import('/src/extensions/blocks.ts');
  const p=(id,text)=>({kind:'paragraph',id,key:`p-${id}`,text,marks:[],inline:[]});
  const img={kind:'image',id:3,key:'image',src:'data:,',alt:'Image'};
  const nodes=[p(1,'First'),{kind:'quote',id:2,key:'quote',children:[img,p(4,'Last')]},p(5,'After')];
  const editor=createEditor(demoSchema,nodes,new RangeSelection({kind:'node',id:3,side:'before'},{kind:'text',id:5,offset:2}));
  const edit=replaceStructuredText(demoSchema,editor.state,'X');
  editor.dispatch({baseRevision:0,origin:'local',history:'separate',time:0,...edit});
  const cleaned=editor.state.nodes.map(n=>n.kind==='paragraph'?n.text:n.kind);
  editor.undo();editor.select(new RangeSelection({kind:'node',id:3,side:'before'},{kind:'node',id:5,side:'after'}));
  editor.dispatch({baseRevision:editor.state.revision,origin:'local',history:'separate',time:1,steps:[{kind:'removeChildren',parent:null,index:1,count:1}]});
  return {cleaned,ranges:editor.state.selection.ranges(selectionContext(demoSchema,editor.state.nodes))};
 });
 expect(result.cleaned).toEqual(['First','Xter']);
 expect(result.ranges).toEqual([{kind:'node',id:5}]);
});

test('large node-only deletion batches siblings and undoes atomically',async({page})=>{
 await page.goto('/editor.html');await page.waitForFunction(()=>window.hybridSpike);
 const result=await page.evaluate(async()=>{
  const {schema}=await import('/tests/fixtures/editor-foundation.js');
  const {createEditor,RangeSelection}=await import('/src/editor/index.ts');
  const nodes=Array.from({length:1024},(_,id)=>({id,key:`atom-${id}`,kind:'atom'}));
  const selection=new RangeSelection({kind:'node',id:0,side:'before'},{kind:'node',id:1023,side:'after'});
  const editor=createEditor(schema,nodes,selection),edit=editor.selectionEdit('');
  editor.dispatch({baseRevision:0,origin:'local',history:'separate',time:0,...edit});
  const count=editor.state.nodes.length;editor.undo();
  return {steps:edit.steps.length,count,restored:editor.state.nodes.length,selection:editor.state.selection.eq(selection)};
 });
 expect(result).toEqual({steps:1,count:0,restored:1024,selection:true});
});
