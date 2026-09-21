import {test,expect} from '@playwright/test';

test('cell rectangles preserve formatting, grow tables, retain unaffected identities and undo atomically',async({page})=>{
 await page.goto('/editor.html');await page.waitForFunction(()=>window.editorDiagnostics);

 const result=await page.evaluate(async()=>{
  const {createEditor,textSelection,indexTree,selectionContext}=await import('/tests/fixtures/table-clipboard.js');
  const {demoSchema}=await import('/tests/fixtures/table-clipboard.js');
  const {createTable,tableCells}=await import('/tests/fixtures/table-clipboard.js');
  const {copyCellRectangle,pasteCellRectangle,cellRectangleText}=await import('/tests/fixtures/table-clipboard.js');
  let next=1;const allocate=()=>({id:next++,key:crypto.randomUUID()});
  const source=createTable(allocate,3,3);
  source.rows.forEach((row,y)=>row.forEach((cell,x)=>{cell.paragraphs[0].text=`${y},${x}`;}));
  source.rows[1][1].paragraphs[0]={...source.rows[1][1].paragraphs[0],kind:'heading',level:2,marks:[{from:0,to:3,mark:{type:'bold',attrs:null}}]};
  source.rows[2][2].paragraphs[0].text='';
  source.rows[2][1].paragraphs.push({kind:'paragraph',...allocate(),text:'Second paragraph',marks:[],inline:[]});
  const selected=new tableCells.CellSelection(source.id,source.rows[2][2].id,source.rows[1][1].id);
  const from=createEditor(demoSchema,[source],selected,[tableCells.extension]);
  const copied=copyCellRectangle(demoSchema,from.state),plain=cellRectangleText(copied);
  const target=createTable(allocate,2,2),original=structuredClone(target);
  const to=createEditor(demoSchema,[target],new tableCells.CellSelection(target.id,target.rows[1][1].id),[tableCells.extension]);
  const command=pasteCellRectangle(demoSchema,to.state,copied,allocate);
  to.dispatch({baseRevision:0,origin:'local',history:'separate',time:1,...command});
  const pasted=to.state.nodes[0],grid=tableCells.grid(selectionContext(demoSchema,to.state.nodes),pasted.id);
  const selectedCells=to.state.selection.cells(selectionContext(demoSchema,to.state.nodes)).length;
  const ids=indexTree(demoSchema,to.state.nodes).order.map(e=>e.node.key);
  const fresh=!ids.some(key=>indexTree(demoSchema,[source]).byKey.has(key));
  to.undo();const undone=JSON.stringify(to.state.nodes[0])===JSON.stringify(original);to.redo();
  // A native text caret inside a destination cell is also a rectangle target.
  to.select(textSelection(pasted.rows[0][0].paragraphs[0].id,0));
  const caret=pasteCellRectangle(demoSchema,to.state,copied,allocate);

  return {shape:[pasted.rows.length,pasted.rows[0].length],values:pasted.rows.map(row=>row.map(c=>c.paragraphs.map(p=>p.text))),heading:pasted.rows[1][1].paragraphs[0],sameCell:pasted.rows[1][1].id===original.rows[1][1].id,untouched:pasted.rows[0][0]===target.rows[0][0],selectedCells,fresh,undone,redo:JSON.stringify(to.state.nodes[0])===JSON.stringify(pasted),plain,grid:[grid.width,grid.height],caret:!!caret};
 });

 expect(result.shape).toEqual([3,3]);expect(result.grid).toEqual([3,3]);expect(result.selectedCells).toBe(4);
 expect(result.values[1].slice(1)).toEqual([['1,1'],['1,2']]);expect(result.values[2].slice(1)).toEqual([['2,1','Second paragraph'],['']]);
 expect(result.heading.kind).toBe('heading');expect(result.heading.marks[0].mark.type).toBe('bold');
 expect(result.sameCell&&result.untouched&&result.fresh&&result.undone&&result.redo&&result.caret).toBe(true);
 expect(result.plain).toBe('1,1\t1,2\n"2,1\nSecond paragraph"\t');
});

test('clipboard HTML is a cropped rectangle and TSV preserves empty and quoted cells',async({page})=>{
 await page.goto('/editor.html');await page.waitForFunction(()=>window.editorDiagnostics);

 const result=await page.evaluate(async()=>{
  const {createEditor}=await import('/tests/fixtures/table-clipboard.js');
  const {demoSchema}=await import('/tests/fixtures/table-clipboard.js');
  const {createTable,tableCells}=await import('/tests/fixtures/table-clipboard.js');
  const {writeClipboard,readClipboard,pasteFragment}=await import('/tests/fixtures/table-clipboard.js');
  const {plainCellRectangle,cellRectangleText}=await import('/tests/fixtures/table-clipboard.js');
  let next=1;const allocate=()=>({id:next++,key:crypto.randomUUID()});
  const table=createTable(allocate,3,3);table.rows[1][1].paragraphs[0].text='Bold';table.rows[1][1].paragraphs[0].marks=[{from:0,to:4,mark:{type:'bold',attrs:null}}];
  const editor=createEditor(demoSchema,[table],new tableCells.CellSelection(table.id,table.rows[2][2].id,table.rows[1][1].id),[tableCells.extension]);
  const data=new DataTransfer();writeClipboard(data,demoSchema,editor.state,'ignored');
  const external=new DataTransfer();external.setData('text/html',data.getData('text/html'));
  const fragment=readClipboard(external),command=pasteFragment(demoSchema,editor.state,fragment,allocate);
  editor.dispatch({baseRevision:0,origin:'local',history:'separate',time:0,...command});
  const tsv='"a\tb"\t"line 1\nline 2"\n"quote ""here"""\t\n',parsed=plainCellRectangle(tsv,allocate);

  return {html:data.getData('text/html'),plain:data.getData('text/plain'),shape:fragment.nodes[0].rows.map(row=>row.length),marks:editor.state.nodes[0].rows[1][1].paragraphs[0].marks,tsv:cellRectangleText(parsed),values:parsed.rows.map(row=>row.map(c=>c.paragraphs[0].text))};
 });

 expect(result.shape).toEqual([2,2]);expect(result.html.match(/<tr>/g)).toHaveLength(2);expect(result.html).toContain('<strong>Bold</strong>');
 expect(result.plain).toBe('Bold\t\n\t');expect(result.marks[0].mark.type).toBe('bold');
 expect(result.values).toEqual([['a\tb','line 1\nline 2'],['quote "here"','']]);
 expect(result.tsv).toBe('"a\tb"\t"line 1\nline 2"\n"quote ""here"""\t');
});

test('table view routes copy, paste and cut through rich clipboard commands',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/editor.html');await page.waitForFunction(()=>window.editorDiagnostics);
 await page.locator('summary[aria-label="Table"]').click();await page.getByRole('button',{name:'Table (3 × 3)',exact:true}).click();
 await page.getByRole('button',{name:'Edit cell 1, 1',exact:true}).click();await page.getByLabel('Cell 1, 1 text',{exact:true}).fill('Alice');
 await page.getByRole('button',{name:'Select cell 1, 1',exact:true}).click();await page.getByRole('button',{name:'Bold',exact:true}).click();
 await page.getByRole('button',{name:'Select cell 2, 2',exact:true}).click({modifiers:['Shift']});

 const copied=await page.evaluate(()=>{const event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});document.querySelector('[data-table]').dispatchEvent(event);

return {html:event.clipboardData.getData('text/html'),text:event.clipboardData.getData('text/plain'),token:event.clipboardData.getData('application/x-gprose-fragment')};});

 expect(copied.html).toContain('<strong>Alice</strong>');
 await page.getByRole('button',{name:'Select cell 3, 3',exact:true}).click();
 await page.evaluate(copied=>{const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()}),data=event.clipboardData;data.setData('text/html',copied.html);data.setData('text/plain',copied.text);data.setData('application/x-gprose-fragment',copied.token);document.querySelector('[data-table]').dispatchEvent(event);},copied);
 await expect(page.getByRole('table').locator('tr')).toHaveCount(4);
 await expect(page.getByRole('button',{name:'Edit cell 3, 3',exact:true})).toHaveText('Alice');
 await expect(page.locator('[data-cell][data-selected="true"]')).toHaveCount(4);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByRole('table').locator('tr')).toHaveCount(3);
 await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.getByRole('table').locator('tr')).toHaveCount(4);
 await page.evaluate(()=>document.querySelector('[data-table]').dispatchEvent(new ClipboardEvent('cut',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()})));
 await expect(page.getByRole('button',{name:'Edit cell 3, 3',exact:true})).not.toHaveText('Alice');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByRole('button',{name:'Edit cell 3, 3',exact:true})).toHaveText('Alice');
 expect(errors).toEqual([]);
});

test('rectangle paste uses source size and rejects protected targets and merged grids without edits',async({page})=>{
 await page.goto('/editor.html');await page.waitForFunction(()=>window.editorDiagnostics);

 const result=await page.evaluate(async()=>{
  const {createEditor,createTable,tableCells,demoSchema,pasteCellRectangle,copyCellRectangle}=await import('/tests/fixtures/table-clipboard.js');
  let next=1;const allocate=()=>({id:next++,key:crypto.randomUUID()});
  const table=createTable(allocate,3,3);table.rows.forEach(row=>row.forEach(c=>c.paragraphs[0].text='keep'));
  const source=createTable(allocate,1,1);source.rows[0][0].paragraphs[0].text='only';
  const selection=new tableCells.CellSelection(table.id,table.rows[2][2].id,table.rows[1][1].id);
  const editor=createEditor(demoSchema,[table],selection,[tableCells.extension]);
  editor.dispatch({baseRevision:0,origin:'local',history:'separate',time:0,...pasteCellRectangle(demoSchema,editor.state,source,allocate)});
  const values=editor.state.nodes[0].rows.map(row=>row.map(c=>c.paragraphs[0].text));
  const blocked=table.rows[1][2].id;
  const secure=createEditor(demoSchema,[table],new tableCells.CellSelection(table.id,table.rows[1][1].id),[tableCells.extension],{permissions:{access:n=>n.id===blocked?'read-only':'editable'}});
  const before=JSON.stringify(secure.state.nodes),wide=createTable(allocate,1,2);let denied=false;

  try{secure.dispatch({baseRevision:0,origin:'local',history:'separate',time:0,...pasteCellRectangle(demoSchema,secure.state,wide,allocate)});}catch{denied=true;}

  const merged=createTable(allocate,3,2);merged.rows[1]=[{...merged.rows[1][0],colspan:2}];
  const whole=createEditor(demoSchema,[merged],new tableCells.CellSelection(merged.id,merged.rows[0][0].id,merged.rows[2][1].id),[tableCells.extension]);
  const copied=copyCellRectangle(demoSchema,whole.state);let rejected=false,partial=false;

  try{pasteCellRectangle(demoSchema,editor.state,copied,allocate);}catch{rejected=true;}

  whole.select(new tableCells.CellSelection(merged.id,merged.rows[0][1].id,merged.rows[2][1].id));

  try{copyCellRectangle(demoSchema,whole.state);}catch{partial=true;}

  return {values,denied,unchanged:JSON.stringify(secure.state.nodes)===before&&secure.state.revision===0,rejected,partial,colspan:copied.rows[1][0].colspan};
 });

 expect(result.values).toEqual([['keep','keep','keep'],['keep','only','keep'],['keep','keep','keep']]);
 expect(result.denied&&result.unchanged&&result.rejected&&result.partial).toBe(true);expect(result.colspan).toBe(2);
});

test('large rectangles expand in both dimensions and retain header formatting',async({page})=>{
 await page.goto('/editor.html');await page.waitForFunction(()=>window.editorDiagnostics);

 const result=await page.evaluate(async()=>{
  const {createEditor,createTable,tableCells,demoSchema,pasteCellRectangle,selectionContext,indexTree}=await import('/tests/fixtures/table-clipboard.js');
  let next=1;const allocate=()=>({id:next++,key:crypto.randomUUID()});
  const target=createTable(allocate,24,24),source=createTable(allocate,32,32);
  source.rows.forEach((row,y)=>row.forEach((cell,x)=>cell.paragraphs[0].text=`${y}:${x}`));
  const editor=createEditor(demoSchema,[target],new tableCells.CellSelection(target.id,target.rows[20][20].id),[tableCells.extension]);
  const before=JSON.stringify(target),start=performance.now(),command=pasteCellRectangle(demoSchema,editor.state,source,allocate);
  editor.dispatch({baseRevision:0,origin:'local',history:'separate',time:0,...command});
  const elapsed=performance.now()-start,table=editor.state.nodes[0],grid=tableCells.grid(selectionContext(demoSchema,editor.state.nodes),table.id);
  const selected=editor.state.selection.cells(selectionContext(demoSchema,editor.state.nodes)).length;
  const count=indexTree(demoSchema,editor.state.nodes).order.length;
  editor.undo();

return {shape:[grid.width,grid.height],last:table.rows[51][51].paragraphs[0].text,header:table.rows[20][20].header,selected,count,elapsed,undo:JSON.stringify(editor.state.nodes[0])===before};
 });

 expect(result.shape).toEqual([52,52]);expect(result.selected).toBe(1024);expect(result.last).toBe('31:31');expect(result.header&&result.undo).toBe(true);expect(result.count).toBe(1+52*52*2);
 console.log(`1024-cell paste: ${result.elapsed.toFixed(1)} ms`);
});
