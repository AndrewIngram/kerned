import type { Mark, NodeIdentity, SelectionRange } from '@kerned/model';

export type Step<N extends NodeIdentity> =
  | {
      kind: 'replaceText';
      id: number;
      from: number;
      to: number;
      text: string;
      marks?: readonly Mark[];
    }
  | {
      kind: 'replaceRanges';
      ranges: readonly SelectionRange[];
      text: string;
      marks?: readonly Mark[];
      pruneEmpty: readonly number[];
    }
  | { kind: 'split'; id: number; at: number; rightId: number; rightKey: string }
  | { kind: 'join'; left: number; right: number }
  | { kind: 'updateBlock'; node: N }
  | { kind: 'append'; nodes: N[] }
  | { kind: 'insertChildren'; parent: number | null; index: number; nodes: N[] }
  | { kind: 'replaceChildren'; parent: number | null; index: number; count: number; nodes: N[] }
  | { kind: 'removeChildren'; parent: number | null; index: number; count: number }
  | {
      kind: 'moveChildren';
      parent: number | null;
      index: number;
      count: number;
      toParent: number | null;
      toIndex: number;
    }
  | { kind: 'wrapChildren'; parent: number | null; index: number; count: number; wrapper: N }
  | { kind: 'unwrap'; id: number };
