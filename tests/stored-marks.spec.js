import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{await page.goto('/editor.html');await page.waitForFunction(()=>window.editorDiagnostics);});

test('caret toolbar formats subsequent typing and Enter without a document edit on toggle',async({page})=>{
 await page.evaluate(()=>window.editorDiagnostics.select(1,0));
 const bold=page.getByRole('button',{name:'Bold',exact:true});
 const before=await page.evaluate(()=>({revision:window.editorDiagnostics.comments().revision,history:window.editorDiagnostics.history()}));
 await expect(bold).toBeEnabled();await bold.click();await expect(bold).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>({revision:window.editorDiagnostics.comments().revision,history:window.editorDiagnostics.history()}))).toEqual(before);
 await page.keyboard.type('Bold');await page.keyboard.press('Enter');await page.keyboard.type('More');
 let nodes=await page.evaluate(()=>window.editorDiagnostics.read().nodes);
 expect(nodes[0].text).toBe('Bold');expect(nodes[0].marks.some(s=>(s.mark.type==='bold')&&s.from===0&&s.to===4)).toBe(true);
 expect(nodes[1].text.startsWith('More')).toBe(true);expect(nodes[1].marks.some(s=>(s.mark.type==='bold')&&s.from===0&&s.to===4)).toBe(true);
 await bold.click();await expect(bold).toHaveAttribute('aria-pressed','false');await page.keyboard.type('plain');
 nodes=await page.evaluate(()=>window.editorDiagnostics.read().nodes);expect(nodes[1].marks.filter(s=>(s.mark.type==='bold')).every(s=>s.to<=4)).toBe(true);
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(bold).toHaveAttribute('aria-pressed','false');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(bold).toHaveAttribute('aria-pressed','true');
 await page.evaluate(()=>window.editorDiagnostics.select(1,0));await expect(bold).toHaveAttribute('aria-pressed','true');
 await page.evaluate(()=>window.editorDiagnostics.select(3,1));await expect(bold).toHaveAttribute('aria-pressed','false');
});

test('stored marks are explicit, reset on movement, restore with history and preserve graphemes',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {createEditor,textSelection,inputMarks}=await import('/src/editor/index.ts');
  const {demoSchema}=await import('/src/extensions/demo-schema.ts');
  const bold={type:'bold',attrs:null};
  const editor=createEditor(demoSchema,[{kind:'paragraph',id:1,key:'p',text:'abCD',marks:[{from:0,to:2,mark:{type:'bold',attrs:null}}],inline:[]}],textSelection(1,2));
  const inherited=inputMarks(demoSchema,editor.state);
  editor.setStoredMarks([]);const revision=editor.state.revision;
  editor.dispatch({baseRevision:revision,origin:'local',history:'separate',time:0,input:true,steps:[{kind:'replaceText',id:1,from:2,to:2,text:'x'}],selection:textSelection(1,3)});
  const plain=editor.state.nodes[0].marks.every(s=>s.to<=2);editor.undo();const undone=editor.state.storedMarks;editor.redo();const redone=editor.state.storedMarks;
  editor.select(textSelection(1,1));const reset=editor.state.storedMarks,active=inputMarks(demoSchema,editor.state);
  editor.setStoredMarks([bold]);
  editor.dispatch({baseRevision:editor.state.revision,origin:'local',history:'separate',time:1,input:true,steps:[{kind:'replaceText',id:1,from:1,to:1,text:'\u0301'}],selection:textSelection(1,2)});
  const grapheme=editor.state.nodes[0].marks.some(s=>(s.mark.type==='bold')&&s.from===0&&s.to>=2);
  const snapshot=editor.state;let rejected=false;

try{editor.setStoredMarks([{type:'missing',attrs:null}]);}catch{rejected=true;}

  return {inherited,revision,plain,undone,redone,reset,active,grapheme,rejected,atomic:editor.state===snapshot};
 });

 expect(result).toEqual({inherited:[{type:'bold',attrs:null}],revision:0,plain:true,undone:[],redone:[],reset:null,active:[{type:'bold',attrs:null}],grapheme:true,rejected:true,atomic:true});
});

test('replacement inherits selected text and loading preserves a pending override',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {createEditor,textSelection,TextSelection,inputMarks}=await import('/src/editor/index.ts');
  const {demoSchema}=await import('/src/extensions/demo-schema.ts');
  const {formattingMarks}=await import('/src/extensions/formatting.ts');
  const node=(id,text,spans=[])=>({kind:'paragraph',id,key:`p${id}`,text,marks:formattingMarks(spans),inline:[]});
  const editor=createEditor(demoSchema,[node(1,'aB',[{start:1,end:2,bold:true,italic:false}]),node(2,'CD')],new TextSelection({id:1,offset:1},{id:2,offset:1}));
  const command=editor.selectionEdit('X');editor.dispatch({baseRevision:0,origin:'local',history:'separate',time:0,input:true,...command});
  const replacement=editor.state.nodes[0].marks.some(s=>(s.mark.type==='bold')&&s.from===1&&s.to===2);
  editor.select(textSelection(1,0));editor.setStoredMarks([{type:'italic',attrs:null}]);
  editor.dispatch({baseRevision:editor.state.revision,origin:'stream',history:'exclude',steps:[{kind:'append',nodes:[node(3,'Loaded')]}]});
  const pending=inputMarks(demoSchema,editor.state);
  const locked=createEditor(demoSchema,[node(4,'No')],textSelection(4,0),[],{permissions:{access:()=> 'read-only'}});
  let denied=false;

try{locked.setStoredMarks([{type:'bold',attrs:null}]);}catch{denied=true;}

  return {replacement,pending,denied,untouched:locked.state.storedMarks===null};
 });

 expect(result).toEqual({replacement:true,pending:[{type:'italic',attrs:null}],denied:true,untouched:true});
});

test('caret formatting retains table input focus and formats cell text',async({page})=>{
 await page.locator('.table-menu summary').click();await page.getByRole('button',{name:'Table (3 × 3)',exact:true}).click();
 await page.getByRole('button',{name:'Edit cell 1, 1',exact:true}).click();
 const input=page.getByLabel('Cell 1, 1 text',{exact:true});await expect(input).toBeFocused();
 await page.getByRole('button',{name:'Bold',exact:true}).click();await expect(input).toBeFocused();await page.keyboard.type('Bold cell');
 const cell=await page.evaluate(()=>window.editorDiagnostics.read().nodes.find(n=>n.kind==='table').rows[0][0].paragraphs[0]);
 expect(cell.text).toBe('Bold cell');expect(cell.marks.some(s=>(s.mark.type==='bold')&&s.from===0&&s.to===9)).toBe(true);
});
