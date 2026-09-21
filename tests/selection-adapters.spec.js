import { test, expect } from '@playwright/test';

test('selection projection preserves node, container, cell and empty selections', async ({ page }) => {
  await page.goto('/editor.html');
  await page.waitForFunction(() => window.hybridSpike);
  const result = await page.evaluate(async () => {
    const { fixture, schema } = await import('/tests/fixtures/editor-foundation.js');
    const { selectionView, selectionContext, NodeSelection, AllSelection } = await import('/src/editor/index.ts');
    const editor = fixture(), context = selectionContext(schema, editor.state.nodes);
    const nodes = context.order().filter(n => schema.children(n).length === 0);
    const indexes = new Map(nodes.map((n, i) => [n.id, i]));
    const node = new NodeSelection(17), view = selectionView(schema, node, context, indexes);
    const container = selectionView(schema, new NodeSelection(1), context, indexes);
    const all = selectionView(schema, new AllSelection(), context, indexes);
    const empty = selectionView(schema, new AllSelection(), selectionContext(schema, []), new Map());
    return {
      identity: view.selection === node, text: view.textSelection, focus: view.focusId,
      first: view.selectedRange(nodes[0]), atom: view.selectedRange(nodes.at(-1)),
      container: nodes.filter(n => container.selectedRange(n)).map(n => n.id),
      all: nodes.filter(n => all.selectedRange(n)).map(n => n.id),
      empty: {focus: empty.focusId, text: empty.textSelection, start: empty.start, ranges: empty.ranges},
    };
  });
  expect(result.identity).toBe(true);
  expect(result.text).toBeNull();
  expect(result.focus).toBe(17);
  expect(result.first).toBeNull();
  expect(result.atom).toEqual({from: 0, to: 1});
  expect(result.container).toEqual([3, 4]);
  expect(result.all).toEqual([3, 4, 8, 10, 13, 15, 16, 17]);
  expect(result.empty).toEqual({focus: null, text: null, start: null, ranges: []});
});

test('starter commands target the selected node and disjoint cells, never the first paragraph', async ({ page }) => {
  await page.goto('/editor.html');
  await page.waitForFunction(() => window.hybridSpike);
  const result = await page.evaluate(async () => {
    const {React, createRoot, flushSync} = await import('/tests/fixtures/selection-probe.js');
    const {createEditor, NodeSelection, textSelection, selectionContext} = await import('/src/editor/index.ts');
    const {demoSchema} = await import('/src/extensions/demo-schema.ts');
    const {createTable, tableCells} = await import('/src/extensions/table.ts');
    const {useEditorDocument} = await import('/src/extensions/starter-kit/use-editor-document.ts');
    const {createStarterKitActions} = await import('/src/extensions/starter-kit/actions.ts');
    const {createStarterKitInput} = await import('/src/extensions/starter-kit/input.ts');
    const {createTextInput} = await import('/src/editor-browser/text-input.ts');
    let next = 10;
    const allocate = () => ({id: next++, key: crypto.randomUUID()});
    const paragraph = (id, text) => ({id, key: `p-${id}`, kind:'paragraph', text, marks:[], inline:[]});
    const table = createTable(allocate);
    const editor = createEditor(demoSchema, [paragraph(1,'First'), {id:2,key:'image',kind:'image',src:'',alt:'Image'}, table], textSelection(1,2), [tableCells.extension]);
    let doc;
    function Probe(){doc=useEditorDocument(editor);return null;}
    const host=document.createElement('div');document.body.append(host);
    const root=createRoot(host);flushSync(()=>root.render(React.createElement(Probe)));
    const notices=[];
    const actions=()=>createStarterKitActions({editor,document:doc,onEdit(){},notice:m=>notices.push(m),closePanel(){},focus(){},syncInput(){}});
    const input=document.createElement('textarea'),capture=createTextInput(demoSchema,editor);
    capture.sync(input);
    flushSync(()=>editor.select(new NodeSelection(2)));
    capture.sync(input);
    const node={targets:doc.selectedBlocks.map(n=>n.id),focus:doc.active.id,input:input.value,text:doc.textSelection};
    flushSync(()=>actions().setHeading(2));
    const firstAfterHeading=editor.state.nodes[0].kind;
    const clipboard=new DataTransfer();
    const events=createStarterKitInput({editor,document:doc,actions:actions(),textInput:capture,input:()=>input,notice:m=>notices.push(m),closePanel(){},escape(){},selectAll(){},navigate(){return false;}});
    flushSync(()=>events.cut({preventDefault(){},clipboardData:clipboard}));
    const cut={text:clipboard.getData('text/plain'),first:editor.state.nodes[0].text,image:editor.state.nodes.some(n=>n.id===2)};
    flushSync(()=>actions().restore());
    flushSync(()=>actions().insertTable());
    const order=editor.state.nodes.map(n=>n.kind);
    const {TextSelection}=await import('/src/editor/index.ts');
    const insertedTable=editor.state.nodes[2], after=editor.state.nodes[3];
    flushSync(()=>editor.select(new TextSelection({id:1,offset:0},{id:after.id,offset:0})));
    const spanning={targets:doc.selectedBlocks.map(n=>n.kind),table:doc.selectedRange(insertedTable)};
    flushSync(()=>editor.select(new tableCells.CellSelection(table.id,table.rows[0][0].id,table.rows[1][0].id)));
    const context=selectionContext(demoSchema,editor.state.nodes);
    const expected=editor.state.selection.ranges(context).map(r=>r.id);
    const targets=doc.selectedBlocks.map(n=>n.id);
    flushSync(()=>actions().setHeading(3));
    const updated=selectionContext(demoSchema,editor.state.nodes);
    const selectedKinds=expected.map(id=>updated.node(id).kind);
    const untouched=updated.node(table.rows[0][1].paragraphs[0].id).kind;
    flushSync(()=>editor.select(new NodeSelection(2)));
    flushSync(()=>actions().replaceCells('Replacement'));
    const replacement=editor.state.nodes.map(n=>({kind:n.kind,text:n.text}));
    root.unmount();host.remove();
    return {node,cut,spanning,firstAfterHeading,order,expected,targets,selectedKinds,untouched,replacement,errors:notices.filter(Boolean)};
  });
  expect(result.node).toEqual({targets:[2],focus:2,input:'',text:null});
  expect(result.cut).toEqual({text:'Image',first:'First',image:false});
  expect(result.firstAfterHeading).toBe('paragraph');
  expect(result.order.slice(0,4)).toEqual(['paragraph','image','table','paragraph']);
  expect(result.spanning).toEqual({targets:['paragraph','image','table'],table:{from:0,to:1}});
  expect(result.targets).toEqual(result.expected);
  expect(result.selectedKinds.every(kind=>kind==='heading')).toBe(true);
  expect(result.untouched).toBe('paragraph');
  expect(result.replacement[0]).toEqual({kind:'paragraph',text:'First'});
  expect(result.replacement[1]).toEqual({kind:'paragraph',text:'Replacement'});
  expect(result.errors).toEqual([]);
});

test('atomic navigation respects document order and preserves shift ranges', async ({page}) => {
  await page.goto('/editor.html');
  await page.waitForFunction(() => window.hybridSpike);
  const result = await page.evaluate(async () => {
    const {moveNodeSelection,NodeSelection,RangeSelection,TextSelection,textSelection} = await import('/src/editor/index.ts');
    const nodes=[{id:1,text:'Before',selectable:true},{id:2,text:null,selectable:true},{id:3,text:null,selectable:false},{id:4,text:null,selectable:true},{id:5,text:'After',selectable:true}];
    const key=(key,shiftKey=false)=>({key,shiftKey,altKey:false,ctrlKey:false,metaKey:false});
    const describe=s=>(s instanceof TextSelection||s instanceof RangeSelection)?{type:s.type,anchor:s.anchor,head:s.head}:s?{type:s.type,id:s.id}:null;
    const move=(selection,event,textMove=null)=>describe(moveNodeSelection(selection,event,nodes,textMove));
    return {
      enter:move(textSelection(1,6),key('ArrowRight'),textSelection(5,0)),
      adjacent:move(new NodeSelection(2),key('ArrowRight')),
      back:move(new NodeSelection(2),key('ArrowLeft')),
      forward:move(new NodeSelection(4),key('ArrowDown')),
      shift:move(new NodeSelection(2),key('ArrowRight',true)),
      middle:move(textSelection(1,3),key('ArrowRight'),textSelection(1,4)),
      modified:move(new NodeSelection(2),{...key('ArrowRight'),altKey:true}),
      edge:describe(moveNodeSelection(new NodeSelection(2),key('ArrowLeft'),[nodes[1]],null)),
    };
  });
  expect(result.enter).toEqual({type:'node',id:2});
  expect(result.adjacent).toEqual({type:'node',id:4});
  expect(result.back.head).toEqual({id:1,offset:6});
  expect(result.forward.head).toEqual({id:5,offset:0});
  expect(result.shift).toEqual({type:'range',anchor:{kind:'node',id:2,side:'before'},head:{kind:'node',id:4,side:'after'}});
  expect(result.middle).toBeNull();
  expect(result.modified).toBeNull();
  expect(result.edge).toEqual({type:'node',id:2});
});

test('clicking an atomic view selects it while interactive descendants retain native input', async ({page}) => {
  await page.goto('/hybrid-editor.html?stream=32');
  await page.waitForFunction(() => window.hybridSpike);
  await page.evaluate(()=>window.hybridSpike.scrollTo(window.hybridSpike.read().nodes.find(n=>n.kind==='image').id));
  const image=page.locator('[data-editor-node]').filter({has:page.locator('[data-image]')}).first();
  await image.scrollIntoViewIfNeeded();
  const id=Number(await image.getAttribute('data-editor-node'));
  await image.click();
  await expect(image).toHaveAttribute('data-selected','true');
  expect(await page.evaluate(()=>window.hybridSpike.read().selection.type)).toBe('node');
  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(()=>window.hybridSpike.read().selection.type)).toBeUndefined();
  await page.keyboard.press('ArrowRight');
  await expect(image).toHaveAttribute('data-selected','true');
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(()=>window.hybridSpike.read().selection.type)).toBeUndefined();
  await image.click();
  await page.keyboard.press('Shift+ArrowRight');
  const extended=await page.evaluate(()=>window.hybridSpike.read().selection);
  expect(extended.type).toBe("range");
  expect(extended.anchor.id).toBe(id);
  await expect(image).toHaveAttribute('data-selected','true');
  await image.click();
  await page.keyboard.press('PageDown');
  expect(await page.evaluate(()=>window.hybridSpike.read().selection.type)).toBeUndefined();
  await page.evaluate(id=>window.hybridSpike.scrollTo(id),id);
  await image.click();
  await page.keyboard.press('Control+End');
  expect(await page.evaluate(()=>window.hybridSpike.read().selection.type)).toBeUndefined();
  await page.evaluate(id=>window.hybridSpike.scrollTo(id),id);
  await image.click();
  await page.evaluate(()=>window.hybridSpike.scrollTo(window.hybridSpike.read().nodes.find(n=>n.kind==='checklist').id));
  const checklist=page.locator('[data-widget]').first();
  await checklist.scrollIntoViewIfNeeded();
  const checkbox=checklist.locator('input[type=checkbox]').first();
  const checked=await checkbox.isChecked();
  await checkbox.click();
  expect(await checkbox.isChecked()).toBe(!checked);
  expect(await page.evaluate(()=>window.hybridSpike.read().selection.type)).toBe('node');
  expect(id).toBeGreaterThan(0);
});
