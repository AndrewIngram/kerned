import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/editor.html');});

test('custom attribute marks replace only their type and round-trip with versions',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {createMarkSchema,setMark,removeMark,hasMark,sliceMarks}=await import('/src/editor/index.ts');
  const schema=createMarkSchema([{name:'link',version:2,parse(value){if(typeof value!=='object'||value===null||typeof value.href!=='string'||!value.href.startsWith('https://'))throw new Error('Invalid link');return {href:value.href};}},{name:'emphasis',version:1,parse(value){if(value!==null)throw new Error('Invalid emphasis');return null;}}]);
  const a=schema.create('link',{href:'https://a.test'}),b=schema.create('link',{href:'https://b.test'}),em=schema.create('emphasis',null);
  let ranges=setMark([],0,10,a);ranges=setMark(ranges,2,8,em);ranges=setMark(ranges,4,6,b);
  const restored=schema.decode('0123456789',JSON.parse(JSON.stringify(schema.encode(ranges))));
  const rejected=[];for(const mutate of [v=>v[0].mark.version=3,v=>v[0].mark.attrs={href:'javascript:bad'},v=>v[0].to=20]){const value=schema.encode(ranges);mutate(value);try{schema.decode('0123456789',value);rejected.push(false);}catch{rejected.push(true);}}
  return {restored,equal:JSON.stringify(restored)===JSON.stringify(ranges),covered:hasMark(ranges,2,8,em),removed:removeMark(ranges,3,7,'link'),sliced:sliceMarks(ranges,3,7),rejected};
 });
 expect(result.equal).toBe(true);expect(result.covered).toBe(true);expect(result.rejected).toEqual([true,true,true]);
 expect(result.restored.map(r=>[r.from,r.to,r.mark.type])).toEqual([[0,4,'link'],[2,8,'emphasis'],[4,6,'link'],[6,10,'link']]);
 expect(result.removed.filter(r=>r.mark.type==='link').map(r=>[r.from,r.to])).toEqual([[0,3],[7,10]]);
 expect(result.sliced.every(r=>r.from>=0&&r.to<=4)).toBe(true);
});

test('demo codecs preserve nested blocks, marks, mentions, locks and table structure',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {demoDocumentCodec}=await import('/src/extensions/demo-schema.ts');
  const {createSampleDocument}=await import('/src/extensions/demo-model.ts');
  const {importHtml}=await import('/src/extensions/html.ts');
  const content=importHtml('<h2>Title</h2><blockquote><p><strong>Bold</strong> <em>italic</em></p></blockquote><ol><li><p>Item</p><ul><li><p>Nested</p></li></ul></li></ol><table><tr><th>One</th><th>Two</th></tr><tr><td>A</td><td><u>B</u></td></tr></table>').nodes;
  content[0]={...content[0],locked:true};
  const encoded=demoDocumentCodec.encode(content),round=demoDocumentCodec.encode(demoDocumentCodec.decode(JSON.parse(JSON.stringify(encoded))));
  const sample=createSampleDocument(),sampleEncoded=demoDocumentCodec.encode(sample),sampleRound=demoDocumentCodec.encode(demoDocumentCodec.decode(JSON.parse(JSON.stringify(sampleEncoded))));
  const failures=[];
  for(const mutate of [v=>v.nodes[0].type='unknown',v=>v.nodes[0].version=999,v=>v.nodes[0].id=1.5,v=>v.nodes[0].locked='true',v=>v.nodes.push(v.nodes[0]),v=>v.nodes[0].children.push(v.nodes[1]),v=>v.nodes[0].data.level=5]){
   const value=structuredClone(encoded);mutate(value);try{demoDocumentCodec.decode(value);failures.push(false);}catch{failures.push(true);}
  }
  return {same:JSON.stringify(encoded)===JSON.stringify(round),sample:JSON.stringify(sampleEncoded)===JSON.stringify(sampleRound),failures,locked:round.nodes[0].locked};
 });
 expect(result).toEqual({same:true,sample:true,failures:[true,true,true,true,true,true,true],locked:true});
});

test('mark commands use a foreign node shape and preserve permissions and atomic undo',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {createSchema,createEditor,textSelection,TextSelection,changeSelectionMarks,selectionHasMark}=await import('/src/editor/index.ts');
  const extension={name:'line',version:1,kind:'text',accepts:n=>n.kind==='line',validateUpdate(){},editing:{text:n=>n.value,replace(){throw new Error('unused');},split(){throw new Error('unused');},join(){throw new Error('unused');},marks:{read:n=>n.styles,write:(n,styles)=>({...n,styles})}}};
  const schema=createSchema([extension]),initial=[1,2].map(id=>({id,key:`n${id}`,kind:'line',value:'Hello',styles:[]}));
  const editor=createEditor(schema,initial,new TextSelection({id:1,offset:1},{id:2,offset:3}));
  const mark={type:'review',attrs:{severity:2}},steps=changeSelectionMarks(schema,editor.state,{kind:'set',mark});
  editor.chain().steps(steps).run();const active=selectionHasMark(schema,editor.state,mark),ranges=editor.state.nodes.map(n=>n.styles);editor.undo();
  const denied=createEditor(schema,initial,textSelection(1,0,4),[],{permissions:{access:()=> 'read-only'}});
  const allowed=denied.can().steps(changeSelectionMarks(schema,denied.state,{kind:'set',mark})).run();
  return {active,ranges,undo:JSON.stringify(editor.state.nodes)===JSON.stringify(initial),allowed};
 });
 expect(result.active).toBe(true);expect(result.undo).toBe(true);expect(result.allowed).toBe(false);
 expect(result.ranges.map(r=>[r[0].from,r[0].to])).toEqual([[1,5],[0,3]]);
});

test('document codecs reload durable comment endpoints with their independent checkpoint',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {demoSchema,demoDocumentCodec}=await import('/src/extensions/demo-schema.ts');
  const {createEditor,textSelection,parseRelativeRange}=await import('/src/editor/index.ts');
  const editor=createEditor(demoSchema,[{id:1,key:'p',kind:'paragraph',text:'Hello world',inline:[],marks:[{from:0,to:5,mark:{type:'bold',attrs:null}}]}],textSelection(1,0));
  const range=editor.positions.range(editor.positions.at(1,0,1),editor.positions.at(1,5,-1));
  editor.chain().step({kind:'replaceText',id:1,from:2,to:2,text:'new'}).run();
  const data=JSON.parse(JSON.stringify({document:demoDocumentCodec.encode(editor.state.nodes),checkpoint:editor.positions.checkpoint(),range,documentId:editor.documentId,revision:editor.state.revision}));
  const restored=createEditor(demoSchema,demoDocumentCodec.decode(data.document),textSelection(1,0),[],{documentId:data.documentId,revision:data.revision,positionCheckpoint:data.checkpoint});
  const output=demoDocumentCodec.encode(restored.state.nodes);output.nodes[0].data.text='mutated output';
  return {resolved:restored.positions.resolveRange(parseRelativeRange(data.range)),text:restored.state.nodes[0].text,bold:restored.state.nodes[0].marks[0].mark.type==='bold'};
 });
 expect(result).toEqual({resolved:{status:'resolved',ranges:[{id:1,from:0,to:8}]},text:'Henewllo world',bold:true});
});

test('third-party node codecs own their payload while core enforces identities',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {createSchema,createDocumentCodec,jsonRecord,jsonString}=await import('/src/editor/index.ts');
  let corrupt=false;
  const extension={name:'card',version:3,kind:'atom',accepts:n=>n.kind==='card',validateUpdate(){},codec:{encode:n=>({title:n.title}),decode(value,{identity}){return {kind:'card',...identity,key:corrupt?'changed':identity.key,title:jsonString(jsonRecord(value).title)};}}};
  const codec=createDocumentCodec(createSchema([extension]));
  const original=[{kind:'card',id:7,key:'stable',locked:true,title:'Custom content'}],encoded=codec.encode(original);
  const round=codec.decode(JSON.parse(JSON.stringify(encoded)));
  const rejects=[];
  for(const value of [null,{}, {...encoded,nodes:[{...encoded.nodes[0],data:{title:42}}]}]){try{codec.decode(value);rejects.push(false);}catch{rejects.push(true);}}
  corrupt=true;try{codec.decode(encoded);rejects.push(false);}catch{rejects.push(true);}
  return {same:JSON.stringify(round)===JSON.stringify(original),rejects};
 });
 expect(result).toEqual({same:true,rejects:[true,true,true,true]});
});
