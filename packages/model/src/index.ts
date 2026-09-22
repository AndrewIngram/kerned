export { type NodeType, type NodeIdentity, type Schema, type TextBehavior } from './schema.js';

export {
  parseRelativePosition,
  parseRelativeRange,
  type RelativePosition,
  type RelativeRange,
} from './relative-values.js';

export { parseRelativeGap, type RelativeGap } from './gap-values.js';

export { parseAnchor, type Anchor } from './anchor-values.js';

export {
  replaceAnnotations,
  sliceAnnotations,
  joinAnnotations,
  type RangeAnnotation,
  type AnnotationPolicy,
} from './annotations.js';

export {
  replaceInlineObjects,
  sliceInlineObjects,
  validateInlineObjects,
  inlinePlainText,
  type InlineObject,
  type InlineExtension,
} from './inline.js';

export { type InlineValue } from './inline-schema.js';

export { boundaries, snapTextOffset, validateTextRange, wordBoundary, wordRange } from './text.js';

export {
  indexTree,
  validateTree,
  childrenAt,
  spliceChildren,
  type TreeEntry,
  type TreeIndex,
} from './tree.js';

export { type TextPoint, type SelectionRange, type DocumentSnapshot } from './coordinates.js';

export {
  sameMark,
  setMark,
  removeMark,
  hasMark,
  normalizeMarks,
  sliceMarks,
  type Mark,
  type MarkRange,
} from './marks.js';

export {
  createDocumentCodec,
  jsonRecord,
  jsonString,
  jsonNumber,
  jsonBoolean,
  jsonArray,
  type JsonValue,
  type NodeCodec,
} from './schema-codec.js';

export { marksAt } from './marks-at.js';

export {
  parseDocumentRange,
  parseRelativeEndpoint,
  type DocumentRange,
  type RelativeEndpoint,
  type RelativeNodeBoundary,
} from './range-values.js';

export {
  defineExtension,
  defineNode,
  defineMark,
  defineInline,
  type SchemaDefinition,
  type ContentDefinition,
  type BehaviorDefinition,
  type DefinitionContribution,
  type DocumentNode,
  type DocumentInput,
  type DocumentMark,
  type DocumentInline,
  type DocumentOutput,
} from './definitions.js';

export { createSchema, type AssembledSchema, type SchemaValues } from './assembly.js';

export { type NodeBinding, type TextNodeContent, type NodeContent } from './node-binding.js';

export { type ValueBinding } from './value-binding.js';

export { textContent } from './text-content.js';

export { renderHtml, type HtmlOutput } from './html-output.js';

export {
  createDocumentSerializer,
  defineNodeSerializer,
  defineMarkSerializer,
  defineInlineSerializer,
  type StaticContent,
  type StaticChild,
  type SerializerContribution,
} from './static-serialization.js';

export type { Immutable } from './immutable-json.js';
