import type { CanvasKit } from 'canvaskit-wasm';
import type { LaidOut } from './engines';
import { createOwnedEngine } from './owned-layout';
import type { OwnedBlock } from './owned-blocks';
import { boundaries, type Span } from './model';

export async function checkOwnedBlocks(kit: CanvasKit) {
  const owned = await createOwnedEngine(kit, 'shaping');
  const checks: Record<string, boolean> = {};
  let assertions = 0;
  function check(label: string, ok: boolean) { assertions++; checks[label] = (checks[label] ?? true) && ok; }
  function compare(a: LaidOut, b: LaidOut, text: string, label: string) {
    check(`${label}:lines`, JSON.stringify(a.lines) === JSON.stringify(b.lines) && a.height === b.height);
    for (const i of boundaries(text)) {
      for (const upstream of [false,true]) {
        const g = a.geometry(i,i,upstream), h = b.geometry(i,i,upstream);
        check(`${label}:caret`, JSON.stringify(g) === JSON.stringify(h));
        check(`${label}:hit`, JSON.stringify(a.hit(g.caret[0],(g.caret[1]+g.caret[3])/2)) === JSON.stringify(b.hit(h.caret[0],(h.caret[1]+h.caret[3])/2)));
        for (const direction of ['left','right','up','down','home','end'] as const) check(`${label}:move`, JSON.stringify(a.move(i,upstream,direction)) === JSON.stringify(b.move(i,upstream,direction)));
      }
      check(`${label}:selection`, JSON.stringify(a.geometry(0,i,false)) === JSON.stringify(b.geometry(0,i,false)));
    }
  }
  function assembled(blocks: readonly OwnedBlock[]) {
    let offset = 0; const spans: Span[] = [];
    for (const block of blocks) {
      spans.push(...block.spans.map(s => ({ ...s, start: s.start + offset, end: s.end + offset })));
      offset += block.text.length + 1;
    }
    return { text: blocks.map(b => b.text).join('\n'), spans };
  }
  const original: OwnedBlock[] = [
    { text: 'office café', spans: [{ start: 0, end: 6, bold: true, italic: false }] },
    { text: '', spans: [] },
    { text: 'Italic and bold overlap', spans: [{start:0,end:15,bold:true,italic:false},{start:7,end:23,bold:false,italic:true}] },
    { text: 'Wrap this paragraph over multiple lines.', spans: [] },
  ];
  // Keep the overlapping span within this fixture's actual bounds.
  const lastStyled = original[2];
  original[2] = { ...lastStyled, spans: lastStyled.spans.map(s => ({...s,end:Math.min(s.end,lastStyled.text.length)})) };
  for (const width of [1,120,333.3,2400]) for (const size of [8,20,72]) {
    const settings = { width,size }, doc = owned.createBlockDocument(settings);
    let blocks = original.slice();
    const saved = doc.splice(0,0,blocks), savedLines = JSON.stringify(saved.lines);
    const compareCurrent = (label: string) => {
      const input = assembled(blocks);
      const cold = owned.engine.layout({ id: 1990,...settings,...input });
      compare(doc.snapshot(),cold,input.text,label);
      owned.release(1990);
    };
    compareCurrent('initial');
    const before = { ...owned.stats };
    check('snapshot:identity',doc.snapshot()===saved && doc.splice(0,0,[])===saved);
    check('snapshot:noWork',JSON.stringify(owned.stats)===JSON.stringify(before));
    const inserted = {text:'An inserted paragraph.',spans:[]};
    doc.splice(1,0,[inserted]); blocks.splice(1,0,inserted); compareCurrent('insert');
    const replacement = {text:'Changed office café',spans:[{start:0,end:7,bold:false,italic:true}]};
    const edits = owned.stats.validatedBlocks;
    doc.splice(2,1,[replacement]); blocks.splice(2,1,replacement);
    check('edit:validation',owned.stats.validatedBlocks===edits+1); compareCurrent('replace');
    doc.splice(1,2,[]); blocks.splice(1,2); compareCurrent('delete');
    const prior = doc.snapshot();
    for (const invalid of [
      [{text:'valid',spans:[]},{text:'bad\nparagraph',spans:[]}],
      [{text:'café',spans:[{start:0,end:4,bold:true,italic:false}]}],
      [{text:'office',spans:[{start:-1,end:2,bold:true,italic:false}]}],
      [{text:'office',spans:[{start:3,end:2,bold:true,italic:false}]}],
      [{text:'valid',spans:[]},{text:'🦄',spans:[]}],
    ]) {
      let rejected = false;
      try { doc.splice(0,1,invalid); } catch { rejected = true; }
      check('failure:atomic',rejected && doc.snapshot()===prior && doc.blockCount===blocks.length);
    }
    for (const [index,count] of [[-1,0],[0,-1],[0.5,0],[doc.blockCount+1,0],[0,doc.blockCount+1]]) {
      let rejected=false;try{doc.splice(index,count,[]);}catch{rejected=true;}
      check('range:atomic',rejected&&doc.snapshot()===prior);
    }
    const validationCount = owned.stats.validatedBlocks, shapeCount = owned.stats.shapeCalls;
    settings.width = width+31;
    doc.configure(settings);
    check('resize:reuse',owned.stats.validatedBlocks===validationCount&&owned.stats.shapeCalls===shapeCount); compareCurrent('resize');
    settings.size = size+1.5; doc.configure(settings);
    check('size:noValidation',owned.stats.validatedBlocks===validationCount); compareCurrent('size');
    const stable = doc.snapshot();
    let rejected=false;try{doc.configure({width:0,size});}catch{rejected=true;}
    check('settings:atomic',rejected&&doc.snapshot()===stable);
    check('old:snapshot',JSON.stringify(saved.lines)===savedLines);
    doc.splice(0,doc.blockCount,[]); blocks=[]; compareCurrent('empty');
    check('empty:blockCount',doc.blockCount===0);
    const empty=doc.snapshot(); doc.release(); doc.release();
    check('release:snapshot',empty.geometry(0,0,false).caret.every(Number.isFinite));
    rejected=false;try{doc.splice(0,0,original);}catch{rejected=true;}
    check('release:closed',rejected);
    check('release:retention',owned.retention().documents===0);
  }
  const a=owned.createBlockDocument({width:300,size:20}), b=owned.createBlockDocument({width:300,size:20});
  const mutable={text:'office',spans:[{start:0,end:6,bold:true,italic:false}]};
  a.splice(0,0,[mutable]); b.splice(0,0,[{text:'Independent',spans:[]}]);
  mutable.spans[0].end=2;mutable.text='Caller changed this';
  const actual=a.configure({width:150,size:20});
  const expected=owned.engine.layout({id:1990,text:'office',spans:[{start:0,end:6,bold:true,italic:false}],width:150,size:20});
  compare(actual,expected,'office','callerMutation');owned.release(1990);
  a.release();check('independent',b.blockCount===1&&b.snapshot().height>0&&owned.retention().documents===1);
  const saved=b.snapshot();owned.engine.clear();
  check('clear:retention',owned.retention().documents===0&&owned.retention().paragraphVariants===0);
  check('clear:snapshot',saved.geometry(0,0,false).caret.every(Number.isFinite));
  let closed=false;try{b.snapshot();}catch{closed=true;}check('clear:closed',closed);
  return {assertions,checks};
}
