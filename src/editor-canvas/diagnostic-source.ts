import type { NodeIdentity } from '../model';
import type { createOwnedEngine } from '../owned-layout';
import type { DocumentLayout } from './document-layout';
import type { ViewDiagnostics, DiagnosticSnapshot } from './view-diagnostics';

type DiagnosticFrame<N extends NodeIdentity> = {
  revision: number;
  layout: DocumentLayout<N>['diagnostics'];
  engine: Pick<Awaited<ReturnType<typeof createOwnedEngine>>, 'stats' | 'retention' | 'memory'>;
  mounted: Iterable<number>;
  painterCount: number;
};

/** Materialize diagnostic data only on demand; no scene/native object escapes. */
export function createDiagnosticSource<N extends NodeIdentity>(
  current: () => DiagnosticFrame<N> | null,
): Pick<ViewDiagnostics, 'read' | 'placements'> {
  return {
    read(): DiagnosticSnapshot | null {
      const frame = current();

      if (!frame) return null;
      const { scene, contentWidth, cachedParagraphs, residentParagraphs } = frame.layout;

      return Object.freeze({
        revision: frame.revision,
        generation: scene.generation,
        pending: scene.pending,
        blocks: scene.placements.length,
        width: contentWidth,
        height: scene.height,
        paddingTop: scene.paddingTop,
        cachedParagraphs,
        residentParagraphs,
        mounted: Object.freeze([...frame.mounted]),
        painterCount: frame.painterCount,
        stats: Object.freeze({ ...frame.engine.stats }),
        retention: Object.freeze(frame.engine.retention()),
        memory: Object.freeze(frame.engine.memory()),
      });
    },
    placements(ids) {
      const frame = current();

      if (!frame) return [];
      const selected = ids && new Set(ids);

      return Object.freeze(
        frame.layout.scene.placements
          .filter((placement) => !selected || selected.has(placement.node.id))
          .map((placement) =>
            Object.freeze({
              id: placement.node.id,
              y: placement.y,
              height: placement.height,
              layoutWidth: placement.layoutWidth,
              resident: placement.layout !== null,
              boxes: Object.freeze(placement.boxes.map((box) => Object.freeze({ ...box }))),
            }),
          ),
      );
    },
  };
}
