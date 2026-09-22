import type { Canvas, Paint } from 'canvaskit-wasm';

import type { FontSelection } from '../canvas/font-catalog.js';
import type { Direction, Position, Span } from './layout-types.js';

export type Rect = [number, number, number, number];

export type Line = {
  direction?: 'ltr' | 'rtl';
  start: number;
  end: number;
  top: number;
  bottom: number;
  baseline: number;
  width: number;
};

export type Geometry = { caret: Rect; rects: Rect[] };

export type LayoutInput = {
  direction?: 'auto' | 'ltr' | 'rtl';
  font?: FontSelection;
  lineHeight?: number;
  baselineGrid?: number;
  id: number;
  text: string;
  spans: Span[];
  width: number;
  size: number;
};

export interface LaidOut {
  height: number;
  lines: Line[];
  coreMs: number;
  adapterMs: number;
  missing: number;
  draw(canvas: Canvas, x: number, y: number, paint?: Paint): void;
  // Document-space vertical interval, before draw translation or canvas scaling.
  drawViewport?(
    canvas: Canvas,
    x: number,
    y: number,
    top: number,
    bottom: number,
    paint?: Paint,
  ): { paragraphs: number; runs: number };
  hit(x: number, y: number): Position;
  geometry(anchor: number, focus: number, upstream: boolean): Geometry;
  move(index: number, upstream: boolean, direction: Direction): Position;
  directionAt?(index: number, upstream: boolean): 'ltr' | 'rtl';
  dispose(): void;
}
