import type { createOwnedEngine } from './owned-layout';
import type { InlineAtom } from './owned-inline';

/** Checks use real shaping and layout, including retained snapshots after updates. */
export function checkInline(owned: Awaited<ReturnType<typeof createOwnedEngine>>) {
  let assertions = 0;
  function check(value: boolean, message: string) {
    if (!value) throw new Error(message);
    assertions++;
  }
  const id = -900;
  try {
    for (const text of ['\ufffc', '\ufffc tail', 'head \ufffc', 'head \ufffc tail', '\ufffc\ufffc', 'café \ufffc office']) {
      const atoms: InlineAtom[] = [...text].flatMap((c, index) => c === '\ufffc' ? [{ id: String(index), index, label: 'Atom', width: 75, ascent: 30, descent: 12 }] : []);
      for (const width of [1, 74, 75, 140, 400]) {
        const layout = owned.layoutInline({ id, text, atoms, spans: [], width, size: 20 });
        for (const box of layout.inlineBoxes) {
          check(Number.isFinite(box.x + box.y) && box.height === 42, 'Invalid inline rectangle');
          const before = layout.geometry(box.index, box.index, false).caret;
          const after = layout.geometry(box.index + 1, box.index + 1, true).caret;
          check(Math.abs(after[0] - before[0] - box.width) < .01, 'Atom width differs from caret advance');
          check(before[1] === after[1], 'Atom split across lines');
          check(layout.hit(box.x + 1, box.y + 20).index === box.index, 'Atom left hit');
          check(layout.hit(box.x + box.width - 1, box.y + 20).index === box.index + 1, 'Atom right hit');
          check(layout.move(box.index, false, 'right').index === box.index + 1, 'Atom right movement');
        }
        const saved = JSON.stringify([layout.lines, layout.geometry(0, text.length, false), layout.inlineBoxes]);
        const shapes = owned.stats.shapeCalls;
        owned.releaseLayout(id);
        const hydrated = owned.layoutInline({id,text,atoms,spans:[],width,size:20});
        check(owned.stats.shapeCalls === shapes, 'Inline hydration reshaped text');
        check(saved === JSON.stringify([hydrated.lines, hydrated.geometry(0, text.length, false), hydrated.inlineBoxes]), 'Inline hydration changed geometry');
        check(saved === JSON.stringify([layout.lines, layout.geometry(0, text.length, false), layout.inlineBoxes]), 'Eviction changed a published inline snapshot');
        owned.layoutInline({ id, text, atoms, spans: [{start:0,end:text.length,bold:true,italic:false}], width: width + 17, size: 28 });
        owned.release(id);
        check(saved === JSON.stringify([layout.lines, layout.geometry(0, text.length, false), layout.inlineBoxes]), 'Retained snapshot changed');
      }
    }
    const atom = {id:'atom',index:0,label:'Atom',width:75,ascent:20,descent:5};
    for (const atoms of [[], [atom,atom], [{...atom,width:NaN}], [{...atom,index:1}]]) {
      let rejected = false;
      try { owned.layoutInline({id,text:'\ufffc',atoms,spans:[],width:100,size:20}); } catch { rejected = true; }
      check(rejected, 'Invalid atom accepted');
    }
    return {assertions};
  } finally { owned.release(id); }
}
