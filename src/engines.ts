import type { Canvas } from 'canvaskit-wasm';

import type { Direction, Position, Span } from './layout-types';

export type Rect = [number, number, number, number];

export type Line = {
  start: number;
  end: number;
  top: number;
  bottom: number;
  baseline: number;
  width: number;
};

export type Geometry = { caret: Rect; rects: Rect[] };

type Input = {
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
  draw(canvas: Canvas, x: number, y: number): void;
  // Document-space vertical interval, before draw translation or canvas scaling.
  drawViewport?(
    canvas: Canvas,
    x: number,
    y: number,
    top: number,
    bottom: number,
  ): { paragraphs: number; runs: number };
  hit(x: number, y: number): Position;
  geometry(anchor: number, focus: number, upstream: boolean): Geometry;
  move(index: number, upstream: boolean, direction: Direction): Position;
  dispose(): void;
}

export interface Engine {
  name: string;
  layout(input: Input): LaidOut;
  clear(): void;
}

export const fontFiles = [
  'NotoSans-Regular.ttf',
  'NotoSans-Bold.ttf',
  'NotoSans-Italic.ttf',
  'NotoSans-BoldItalic.ttf',
  'NotoColorEmoji.ttf',
];
