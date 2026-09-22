export { createTextInput } from './browser/text-input.js';

export type { ObserveTextPointer, TextPointerEvent } from './browser/canvas-input.js';

export { createTextInteraction, positionTextInput } from './browser/text-interaction.js';

export { hitTestTextLines, type TextHit, type TextHitRegion } from './browser/hit-testing.js';

export {
  createTextNavigation,
  type NavigationBlock,
  type NavigationLayout,
  type NavigationKey,
} from './browser/keyboard-navigation.js';

export { textSelectionAtClick } from './browser/selection-view.js';

export {
  textBoundaryNearNode,
  moveNodeSelection,
  type NavigationNode,
} from './browser/node-navigation.js';

export {
  inputPolicies,
  type InputContribution,
  type ViewSession,
} from './browser/input-contributions.js';

export {
  viewLayers,
  type ViewLayerContribution,
  type ViewLayerFrame,
  type ViewLayerContext,
  type LayerBlock,
} from './browser/view-layers.js';

export type {
  Drawing,
  DrawingRect,
  PreparedText,
  PrepareText,
  InlineBounds,
  DrawingLayer,
  DrawingPainter,
  TextFragment,
  BlockTextGeometry,
} from './browser/drawing.js';

export { type TextDecoration, type ReadTextDecorations } from './browser/text-decorations.js';

export { applyTextStyle, type TextStyle, type ReadTextStyle } from './browser/text-style.js';

export {
  nodeViews,
  defineNodeView,
  type NodeViewContribution,
  type NodeViewContext,
  type NodeViewFrame,
  type NodeRenderFrame,
  type NodeViewAttributes,
  type NodeView,
} from './browser/node-views.js';

export {
  decorations,
  type Decoration,
  type NodeDecoration,
  type DecorationActivation,
  type DecorationSource,
  type DecorationContribution,
  type InvalidateDecorations,
} from './browser/decorations.js';

export {
  defineWidgetView,
  type WidgetAnchor,
  type WidgetDecoration,
  type WidgetView,
  type WidgetViewFrame,
} from './browser/widget-views.js';

export {
  defineInlineView,
  defineMarkView,
  type InlineViewFrame,
  type MarkViewFrame,
  type ValueViewAttributes,
  type RangeView,
  type RangeViewContext,
  type RangeViewMount,
} from './browser/range-views.js';

export type { ContentSlot } from './browser/content-slot.js';

export {
  createHtmlParser,
  createEditorHtmlParser,
  defineHtmlTextParser,
  defineHtmlNodeParser,
  defineHtmlValueParser,
  htmlParsers,
  type HtmlParserContribution,
  type HtmlParseContext,
  type HtmlParseRule,
  type ParsedHtmlText,
} from './browser/html-parser.js';

export {
  keyboardShortcuts,
  createKeyboardShortcuts,
  type KeyboardShortcut,
} from './browser/shortcuts.js';

export {
  pasteRules,
  createPasteRules,
  type PasteRule,
  type ClipboardData,
} from './browser/paste-rules.js';

export { mountEditor, type MountedEditor, type MountEditorOptions } from './canvas/mount.js';

export {
  defineNodePresentation,
  presentations,
  type NodePresentation,
} from './canvas/presentation.js';

export type { ResolveEditorAsset, EditorAsset } from './canvas/assets.js';

export type { ViewConfiguration, RevealOptions } from './canvas/view-options.js';

export type { ViewSnapshot, BlockBounds } from './canvas/view-geometry.js';

export {
  defaultFonts,
  type FontConfiguration,
  type FontSelection,
  type FontSource,
} from './canvas/font-catalog.js';

export { defineStyleRule, type StyleRule, type NodeStyle, type ViewTheme } from './canvas/theme.js';

export { mountEditorView, type BrowserViewOptions } from './browser/native-view.js';

export { createDocumentQuery } from './browser/document.js';

export { nativeTextCaret, revealNativeText } from './browser/native-text-geometry.js';

export type { PresentationContext, PresentationContribution } from './canvas/presentation.js';

export type { BlockPresentation } from './canvas/scene.js';

export type { Span as TextSpan } from './internal/layout-types.js';
