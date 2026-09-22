export { type Step } from './steps.js';

export { type AnchorMap, type RevisionMap, invertAnchorMap } from './anchor-maps.js';

export {
  mapPosition,
  mapGapPosition,
  type GapPosition,
  type PositionMap,
  invertPositionMap,
} from './positions.js';

export {
  createPositionSnapshot,
  type SnapshotPosition,
  type SnapshotRange,
  type ResolvedPosition,
  type PositionSnapshot,
  type MappedSnapshotPosition,
  type SnapshotTransition,
} from './document-positions.js';

export {
  applySteps,
  restoreChanges,
  type DocumentChange,
  type TransformOptions,
  type TransformResult,
} from './apply-steps.js';

export { type BoundaryPoint, mapBoundary } from './boundary-maps.js';
