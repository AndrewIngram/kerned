import { expect, test } from 'vitest';

import {
  createViewDiagnostics,
  connectViewDiagnostics,
  type DiagnosticEvent,
} from '../view-diagnostics';

const source = { read: () => null, placements: () => [], inspectText: () => null };

const event: DiagnosticEvent = {
  type: 'paint',
  at: 12,
  duration: 2,
  submitted: 1,
  revision: 0,
  generation: 1,
  pending: 0,
  blocks: 1,
  width: 400,
  mounted: 0,
  stale: false,
};

test('diagnostics leases isolate sequential attachments and cancel old queued events', async () => {
  const diagnostics = createViewDiagnostics();
  const seen: DiagnosticEvent[] = [];
  const unsubscribe = diagnostics.subscribe((value) => seen.push(value));
  const first = connectViewDiagnostics(diagnostics, source);
  expect(first.options).toEqual({ composition: 'viewport', retention: 'viewport' });
  expect(() => connectViewDiagnostics(diagnostics, source)).toThrow(/already has a mounted view/);
  first.emit(event);
  first.destroy();
  const second = connectViewDiagnostics(diagnostics, source);
  first.destroy();
  second.emit(event);
  await Promise.resolve();
  expect(seen).toEqual([event]);
  second.emit(event);
  unsubscribe();
  await Promise.resolve();
  expect(seen).toHaveLength(1);
  expect(second.observed).toBe(false);
  second.destroy();
  expect(diagnostics.read()).toBeNull();
  expect(diagnostics.placements()).toEqual([]);
});

test('an observer may release the attachment without delivering remaining events from it', async () => {
  const diagnostics = createViewDiagnostics({ composition: 'eager', retention: 'all' });
  const lease = connectViewDiagnostics(diagnostics, source);
  expect(lease.options).toEqual({ composition: 'eager', retention: 'all' });
  const seen: DiagnosticEvent[] = [];
  diagnostics.subscribe(() => lease.destroy());
  diagnostics.subscribe((value) => seen.push(value));
  lease.emit(event);
  lease.emit(event);
  await Promise.resolve();
  expect(seen).toEqual([]);
});

test('a diagnostics-shaped object cannot supply or expose native resources', () => {
  expect(() => connectViewDiagnostics({ ...source, subscribe: () => () => {} }, source)).toThrow(
    /createViewDiagnostics/,
  );
});
