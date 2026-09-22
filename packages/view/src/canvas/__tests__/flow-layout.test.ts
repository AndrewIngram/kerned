import { expect, test } from 'vitest';

import { createFlowLayout, emptySlotInsets, type FlowLayoutEvent } from '../flow-layout.js';

const outer = { id: 1, key: 'outer' };

const inner = { id: 2, key: 'inner' };

test('nested flow geometry reserves chrome around leaf heights and puts sibling spacing outside closed containers', () => {
  const events: FlowLayoutEvent<typeof outer>[] = [
    {
      kind: 'open',
      at: 0,
      to: 2,
      node: outer,
      inset: 0,
      endInset: 0,
      chrome: { top: 20, left: 10, right: 15, bottom: 8 },
    },
    {
      kind: 'open',
      at: 1,
      to: 2,
      node: inner,
      inset: 10,
      endInset: 15,
      chrome: { top: 12, left: 4, right: 6, bottom: 3 },
    },
    { kind: 'close', at: 2, id: 2 },
    { kind: 'close', at: 2, id: 1 },
  ];

  const flow = createFlowLayout(events, 300);
  const first = flow.boundary(0, 32, 0);
  expect(first).toBe(52);
  const second = flow.boundary(1, first + 40, 16);
  expect(second).toBe(120);
  expect(flow.boundary(2, second + 60, 16)).toBe(207);
  expect(flow.placements.get(1)).toEqual({
    node: outer,
    bounds: { left: 0, top: 32, width: 300, height: 159 },
    content: { left: 10, top: 20, width: 275, height: 131 },
  });
  expect(flow.placements.get(2)).toEqual({
    node: inner,
    bounds: { left: 10, top: 108, width: 275, height: 75 },
    content: { left: 4, top: 12, width: 265, height: 60 },
  });
  expect([...flow.placements.keys()]).toEqual([1, 2]);
});

test('trailing empty containers have geometry without absorbing the following paragraph margin', () => {
  const flow = createFlowLayout(
    [
      { kind: 'open', at: 0, to: 1, node: outer, inset: 0, endInset: 0, chrome: emptySlotInsets },
      {
        kind: 'open',
        at: 1,
        to: 1,
        node: inner,
        inset: 0,
        endInset: 0,
        chrome: { ...emptySlotInsets, top: 10, bottom: 5 },
      },
      { kind: 'close', at: 1, id: 2 },
      { kind: 'close', at: 1, id: 1 },
    ],
    300,
  );

  expect(flow.boundary(0, 32, 0)).toBe(32);
  expect(flow.boundary(1, 72, 16)).toBe(103);
  expect(flow.placements.get(1)?.bounds.height).toBe(55);
  expect(flow.placements.get(2)?.content.height).toBe(0);
  expect(flow.placements.get(2)?.bounds).toEqual({ left: 0, top: 72, width: 300, height: 15 });
});
