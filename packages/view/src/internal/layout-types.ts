export { boundaries } from '@kerned/model';

export type Span = {
  start: number;
  end: number;
  bold: boolean;
  italic: boolean;
};

export type Position = { index: number; upstream: boolean };

export type Direction = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';
