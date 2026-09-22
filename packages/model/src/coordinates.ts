export type TextPoint = { id: number; offset: number };

export type SelectionRange =
  | { kind: 'text'; id: number; from: number; to: number }
  | { kind: 'node'; id: number };

export type DocumentSnapshot<N> = { nodes: readonly N[]; revision: number };
