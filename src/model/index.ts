export {
  createSchema,
  type NodeExtension,
  type NodeIdentity,
  type Schema,
  type TextBehavior,
} from './schema';

export {
  parseRelativePosition,
  parseRelativeRange,
  type RelativePosition,
  type RelativeRange,
} from './relative-values';

export { parseRelativeGap, type RelativeGap } from './gap-values';

export { parseAnchor, type Anchor } from './anchor-values';

export {
  replaceAnnotations,
  sliceAnnotations,
  joinAnnotations,
  type RangeAnnotation,
  type AnnotationPolicy,
} from './annotations';

export {
  replaceInlineObjects,
  sliceInlineObjects,
  validateInlineObjects,
  inlinePlainText,
  type InlineObject,
  type InlineExtension,
} from './inline';

export { createInlineSchema, type InlineValue, type InlineValueExtension } from './inline-schema';

export { boundaries, validateTextRange, wordBoundary, wordRange } from './text';

export {
  indexTree,
  validateTree,
  childrenAt,
  spliceChildren,
  type TreeEntry,
  type TreeIndex,
} from './tree';

export { type TextPoint, type SelectionRange, type DocumentSnapshot } from './coordinates';

export {
  createMarkSchema,
  sameMark,
  setMark,
  removeMark,
  hasMark,
  normalizeMarks,
  sliceMarks,
  type Mark,
  type MarkRange,
  type MarkExtension,
} from './marks';

export {
  createDocumentCodec,
  jsonRecord,
  jsonString,
  jsonNumber,
  jsonBoolean,
  jsonArray,
  type JsonValue,
  type NodeCodec,
} from './schema-codec';

export { marksAt } from './marks-at';

export {
  parseDocumentRange,
  parseRelativeEndpoint,
  type DocumentRange,
  type RelativeEndpoint,
  type RelativeNodeBoundary,
} from './range-values';
