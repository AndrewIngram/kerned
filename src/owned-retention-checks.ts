import type { createOwnedEngine } from './owned-layout';

export function checkOwnedRetention(owned: Awaited<ReturnType<typeof createOwnedEngine>>) {
  const checks: Record<string, boolean> = {};
  const { engine, stats } = owned;
  engine.clear();
  const blocks = Array.from({ length: 500 }, (_, i) => `Paragraph ${i}: office affinity and café.`);
  function layout(parts: string[], id = 100, width = 300, size = 20) {
    const before = stats.shapeCalls;
    const result = engine.layout({ id, text: parts.join('\n'), spans: [], width, size });
    return { result, calls: stats.shapeCalls - before };
  }
  checks.retentionCold500 = layout(blocks).calls === 500;
  checks.retentionResize500 = layout(blocks, 100, 200).calls === 0;
  const edited = [...blocks];
  edited[250] += ' changed';
  checks.retentionEdit500 = layout(edited).calls === 1;
  checks.retentionNoOldVersions = owned.retention().paragraphVariants === 500;
  checks.retentionUndoReshapesOnlyReverted = layout(blocks).calls === 1;
  const inserted = ['A new first paragraph', ...blocks];
  checks.retentionInsert = layout(inserted).calls === 1;
  checks.retentionDelete = layout(blocks).calls === 0 && owned.retention().paragraphVariants === 500;
  checks.retentionReorder = layout([...blocks].reverse()).calls === 0;
  checks.retentionIndependentDocument = layout(blocks, 101).calls === 500;
  checks.retentionOtherDocumentDoesNotEvict = layout(blocks).calls === 0;
  owned.release(101);
  checks.retentionRelease = owned.retention().documents === 1 && owned.retention().paragraphVariants === 500;
  checks.retentionReleasedDocumentIsCold = layout(blocks, 101).calls === 500;
  owned.release(101);
  let failed = false;
  try { layout(['A new paragraph built before failure', '🚀']); } catch { failed = true; }
  checks.retentionFailedLayoutPreservesPrevious = failed && layout(blocks).calls === 0 && owned.retention().paragraphVariants === 500;
  const old = layout(blocks).result;
  const before = old.geometry(4, 12, false);
  owned.releaseLayout(100);
  checks.retentionGeometryEvicted = owned.memory().composedParagraphs === 0 && owned.memory().caretBufferBytes === 0;
  checks.retentionSnapshotSurvivesGeometryEviction = JSON.stringify(old.geometry(4, 12, false)) === JSON.stringify(before);
  const hydrated = layout(blocks);
  checks.retentionHydratesWithoutShaping = hydrated.calls === 0;
  checks.retentionHydratedGeometry = JSON.stringify(hydrated.result.lines) === JSON.stringify(old.lines) && JSON.stringify(hydrated.result.geometry(4, 12, false)) === JSON.stringify(before);
  owned.release(100);
  checks.retentionSnapshotSurvivesRelease = JSON.stringify(old.geometry(4, 12, false)) === JSON.stringify(before);
  const fresh = layout(blocks).result;
  checks.retentionGeometryMatchesCold = JSON.stringify(fresh.lines) === JSON.stringify(old.lines) && JSON.stringify(fresh.geometry(4, 12, false)) === JSON.stringify(before);
  checks.retentionSizeInvalidates = layout(blocks, 100, 300, 21).calls === 500;
  checks.retentionSizeDropsPrevious = owned.retention().paragraphVariants === 500;
  engine.clear();
  checks.retentionClear = owned.retention().documents === 0 && owned.retention().paragraphVariants === 0;
  return checks;
}
