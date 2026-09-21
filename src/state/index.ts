export {
  createEditor,
  applyTransaction,
  type Transaction,
  type EditorState,
  type EditorOptions,
} from './transactions';

export { type RelativePositionResult, type RelativeRangeResult } from './relative-positions';

export { type RelativeGapResult } from './structural-positions';

export { createAnchor, resolveAnchor, type AnchorResolution } from './anchors';

export {
  extendSelection,
  selectionAnchor,
  type SelectionAnchor,
  RangeSelection,
  rangeSelection,
  endpointOffset,
  type RangeEndpoint,
} from './range-selection';

export { Selection } from './selection-base';

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
} from './selection';

export {
  createFind,
  type EditorFind,
  type FindMatch,
  type FindOptions,
  type FindState,
  type FindSnapshot,
} from './find';

export {
  projectDocument,
  PermissionDenied,
  type AccessPolicy,
  type NodeAccess,
  type ProjectedNode,
} from './permissions';

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
} from './commands';

export {
  createStateField,
  type StateFieldRegistration,
  type ExtensionUpdate,
} from './extension-state';

export { prepareTextProposal, type TextProposal, type PreparedTextProposal } from './proposals';

export {
  resolveRangeDecorations,
  type RangeDecoration,
  resolveDecorations,
  type InlineDecoration,
  type ResolvedDecoration,
  type UnresolvedDecoration,
} from './decorations';

export { changeSelectionMarks, selectionHasMark, type MarkChange } from './mark-commands';

export { inputMarks } from './stored-marks';

export { markActivity, toggleMarkCommand } from './formatting-commands';

export { type DocumentRangeResult } from './document-ranges';

export { selectionView } from './selection-view';

export type { EditorEvents } from './events';

export { type HistoryOptions } from './local-history';
