export type DrawingRect = Readonly<{ left: number; top: number; width: number; height: number }>;

/** Prepared by this view; geometry is public, glyph storage stays private. */
export type PreparedText = Readonly<{ width: number; height: number }>;

export type PrepareText = (input: { text: string; width: number; size: number }) => PreparedText;

/** Borrowed for one paint callback. Coordinates are unscaled document coordinates. */
export type Drawing = {
  rect(bounds: DrawingRect, color: string, radius?: number): void;
  text(label: PreparedText, left: number, top: number): void;
};

export type DrawingLayer = 'background' | 'content';

export type DrawingPainter = (drawing: Drawing) => void;

export type RegisterDrawing = (
  key: string,
  layer: DrawingLayer,
  paint: DrawingPainter,
) => () => void;

export type LayerDrawing = { register: RegisterDrawing; prepareText: PrepareText };

export type InlineBounds = DrawingRect & Readonly<{ id: string; index: number }>;

export type TextFragment = DrawingRect & Readonly<{ baseline: number }>;

/** Immutable geometry in block-local coordinates, including its inherited text inset. */
export type BlockTextGeometry = {
  fragments(from: number, to: number): readonly TextFragment[];
};
