export type DrawingRect = Readonly<{ left: number; top: number; width: number; height: number }>;

/** Borrowed for one paint callback. Coordinates are unscaled document coordinates. */
export type Drawing = {
  rect(bounds: DrawingRect, color: string, radius?: number): void;
};

export type DrawingLayer = 'background' | 'content';

export type DrawingPainter = (drawing: Drawing) => void;

export type RegisterDrawing = (
  key: string,
  layer: DrawingLayer,
  paint: DrawingPainter,
) => () => void;

export type TextFragment = DrawingRect & Readonly<{ baseline: number }>;

/** Immutable geometry in block-local coordinates, including its inherited text inset. */
export type BlockTextGeometry = {
  fragments(from: number, to: number): readonly TextFragment[];
};
