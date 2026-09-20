import type { CanvasKit } from 'canvaskit-wasm';
import type { LaidOut } from './engines';
import { createOwnedEngine } from './owned-layout';

export async function createOwnedMemorySession(kit: CanvasKit, storage: 'objects' | 'carets' | 'shaping', count: number) {
  const owned = await createOwnedEngine(kit, storage);
  const blocks = Array.from({ length: count }, (_, i) => `Paragraph ${i}: office affinity café AV To with enough words to wrap.`);
  const text = blocks.join('\n');
  let current: LaidOut | undefined;
  let pinned: LaidOut | undefined;
  let width = 350;
  function layout(value = text) {
    current = owned.engine.layout({ id: 980, text: value, spans: [], width, size: 20 });
  }
  // Warm the font, native allocator and code before measuring the empty baseline.
  layout(); current = undefined; owned.release(980);
  function state() {
    return { retention: owned.retention(), memory: owned.memory(), snapshots: Number(!!current) + Number(!!pinned), pinnedHeight: pinned?.height ?? null };
  }
  return {
    state,
    step(stage: string) {
      switch (stage) {
        case 'loaded': layout(); break;
        case 'wide': width = 1200; layout(); break;
        case 'narrow': width = 1; layout(); break;
        case 'restore': width = 350; layout(); break;
        case 'pin-and-resize': pinned = current; width = 240; layout(); break;
        case 'edit-50':
          for (let i = 0; i < 50; i++) layout(text.replace('Paragraph 0:', `Changed ${i} paragraph 0:`));
          break;
        case 'release-cache': owned.release(980); break;
        case 'drop-snapshots': current = undefined; pinned = undefined; break;
        case 'release-cycles':
          for (let i = 0; i < 10; i++) { layout(); current = undefined; owned.release(980); }
          break;
        default: throw new Error(`Unknown memory stage ${stage}`);
      }
      return state();
    },
  };
}
