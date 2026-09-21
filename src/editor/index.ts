export {createSchema,type NodeExtension,type NodeIdentity,type Schema,type TextBehavior} from './schema';
export {createEditor,applyTransaction,type Step,type Transaction,type EditorState,type EditorOptions} from './transactions';
export {parseRelativePosition,parseRelativeRange,type RelativePosition,type RelativeRange,type RelativePositionResult,type RelativeRangeResult} from './relative-positions';
export {parseRelativeGap,type RelativeGap,type RelativeGapResult} from './structural-positions';
export {createAnchor,parseAnchor,resolveAnchor,type Anchor,type AnchorMap,type RevisionMap,type AnchorResolution} from './anchors';
export {replaceAnnotations,sliceAnnotations,joinAnnotations,type RangeAnnotation,type AnnotationPolicy} from './annotations';
export {replaceInlineObjects,sliceInlineObjects,validateInlineObjects,inlinePlainText,type InlineObject,type InlineExtension} from './inline';
export {createInlineSchema,type InlineValue,type InlineValueExtension} from './inline-schema';
export {boundaries,validateTextRange} from './text';
export {indexTree,validateTree,childrenAt,spliceChildren,type TreeEntry} from './tree';

export {extendSelection,selectionAnchor,type SelectionAnchor,RangeSelection,rangeSelection,endpointOffset,type RangeEndpoint,Selection,TextSelection,NodeSelection,AllSelection,textSelection,selectionContext,selectionMapping,selectionNear,createSelectionRegistry,type TextPoint,type SelectionRange,type SelectionContext,type SelectionMapping,type SelectionBookmark,type SelectionEdit,type SelectionStep,type SelectionJSON,type SelectionFragment,type SelectionContent,type SelectionExtension} from './selection';
export {mapPosition,mapGapPosition,type GapPosition,type PositionMap} from './positions';
export {createPositionSnapshot,type SnapshotPosition,type SnapshotRange,type ResolvedPosition,type PositionSnapshot,type MappedSnapshotPosition,type SnapshotTransition} from './document-positions';
export {createFind,type EditorFind,type FindMatch,type FindOptions,type FindState,type FindSnapshot} from './find';

export {hitTestTextLines,type TextHit,type TextHitRegion} from './hit-testing';

export {createTextNavigation,type NavigationBlock,type NavigationLayout,type NavigationKey} from './keyboard-navigation';

export {projectDocument,PermissionDenied,type AccessPolicy,type NodeAccess,type ProjectedNode} from './permissions';

export {commandActivity,type Command,type CommandContext,type CommandDefinition,type CommandActivity,type CommandState} from './commands';
export {createStateField,type StateFieldRegistration,type ExtensionUpdate} from './extension-state';
export {prepareTextProposal,type TextProposal,type PreparedTextProposal} from './proposals';
export {resolveRangeDecorations,type RangeDecoration,resolveDecorations,type InlineDecoration,type ResolvedDecoration,type UnresolvedDecoration} from './decorations';

export {createMarkSchema,sameMark,setMark,removeMark,hasMark,normalizeMarks,sliceMarks,type Mark,type MarkRange,type MarkExtension} from './marks';
export {createDocumentCodec,jsonRecord,jsonString,jsonNumber,jsonBoolean,jsonArray,type JsonValue,type NodeCodec} from './schema-codec';

export {changeSelectionMarks,selectionHasMark,type MarkChange} from './mark-commands';

export {marksAt,inputMarks} from './stored-marks';
export {markActivity,toggleMarkCommand} from './formatting-commands';
export {selectionView,textSelectionAtClick} from './selection-view';

export {textBoundaryNearNode, moveNodeSelection, type NavigationNode} from './node-navigation';

export {parseDocumentRange,parseRelativeEndpoint,type DocumentRange,type DocumentRangeResult,type RelativeEndpoint,type RelativeNodeBoundary} from './document-ranges';
