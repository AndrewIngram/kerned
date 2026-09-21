export { type Step } from './steps';

export { type AnchorMap, type RevisionMap, invertAnchorMap } from './anchor-maps';

export {
  mapPosition,
  mapGapPosition,
  type GapPosition,
  type PositionMap,
  invertPositionMap,
} from './positions';

export {
  createPositionSnapshot,
  type SnapshotPosition,
  type SnapshotRange,
  type ResolvedPosition,
  type PositionSnapshot,
  type MappedSnapshotPosition,
  type SnapshotTransition,
} from './document-positions';

export {
  applySteps,
  restoreChanges,
  type DocumentChange,
  type TransformOptions,
  type TransformResult,
} from './apply-steps';

export { type BoundaryPoint, mapBoundary } from './boundary-maps';
