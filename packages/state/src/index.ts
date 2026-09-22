export {
  createEditor,
  applyTransaction,
  type Transaction,
  type EditorState,
  type EditorOptions,
} from './transactions.js';

export { type RelativePositionResult, type RelativeRangeResult } from './relative-positions.js';

export { type RelativeGapResult } from './structural-positions.js';

export { createAnchor, resolveAnchor, type AnchorResolution } from './anchors.js';

export {
  extendSelection,
  selectionAnchor,
  type SelectionAnchor,
  RangeSelection,
  rangeSelection,
  endpointOffset,
  type RangeEndpoint,
} from './range-selection.js';

export { Selection } from './selection-base.js';

export {
  TextSelection,
  NodeSelection,
  AllSelection,
  textSelection,
  selectionContext,
  selectionMapping,
  selectionNear,
  createSelectionRegistry,
  type SelectionContext,
  type SelectionMapping,
  type SelectionBookmark,
  type SelectionEdit,
  type SelectionStep,
  type SelectionJSON,
  type SelectionFragment,
  type SelectionContent,
  type SelectionExtension,
} from './selection.js';

export {
  createFind,
  type EditorFind,
  type FindMatch,
  type FindOptions,
  type FindState,
  type FindSnapshot,
  type FindStatus,
} from './find.js';

export {
  projectDocument,
  PermissionDenied,
  type AccessPolicy,
  type NodeAccess,
  type ProjectedNode,
} from './permissions.js';

export {
  commandActivity,
  type Command,
  type CommandContext,
  type CommandEdit,
  type CommandOptions,
  type ReadContext,
  type CommandDefinition,
  type CommandActivity,
  type CommandState,
} from './commands.js';

export {
  createStateField,
  type StateFieldRegistration,
  type ExtensionUpdate,
} from './extension-state.js';

export { prepareTextProposal, type TextProposal, type PreparedTextProposal } from './proposals.js';

export {
  resolveRangeDecorations,
  type RangeDecoration,
  resolveDecorations,
  type InlineDecoration,
  type ResolvedDecoration,
  type UnresolvedDecoration,
} from './decorations.js';

export { changeSelectionMarks, selectionHasMark, type MarkChange } from './mark-commands.js';

export { inputMarks } from './stored-marks.js';

export { markActivity, toggleMarkCommand } from './formatting-commands.js';

export { type DocumentRangeResult } from './document-ranges.js';

export { selectionView } from './selection-view.js';

export type { EditorEvents } from './events.js';

export { type HistoryOptions } from './local-history.js';

export { type ScopedSelection, equalScopedSelection, selectionInText } from './scoped-selection.js';

export type { PositionCheckpoint } from './position-checkpoint.js';
