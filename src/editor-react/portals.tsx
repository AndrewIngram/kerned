import { useLayoutEffect, useSyncExternalStore, type ReactNode, type ReactPortal } from 'react';
import { createPortal } from 'react-dom';

const hosts = new WeakMap<HTMLElement, ReturnType<typeof createPortalHost>>();

/** React owns reconciliation; the native view owns each destination's lifetime. */
export function createPortalHost() {
  const entries = new Map<HTMLElement, ReactPortal>();
  const keys = new WeakMap<HTMLElement, string>();
  const listeners = new Set<() => void>();
  const pending = new Set<() => void>();
  let nextKey = 0;
  let snapshot: readonly ReactPortal[] = [];
  let committed = snapshot;

  function publish() {
    snapshot = [...entries.values()];

    for (const listener of listeners) listener();
  }

  function settle() {
    for (const resolve of pending) resolve();
    pending.clear();
  }

  const host = {
    getSnapshot: () => snapshot,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    attach(element: HTMLElement) {
      if (hosts.has(element)) throw new Error('A React portal host is already attached');
      hosts.set(element, host);

      return () => {
        if (hosts.get(element) !== host) return;
        hosts.delete(element);
        entries.clear();
        publish();
        settle();
      };
    },
    render(element: HTMLElement, content: ReactNode) {
      let key = keys.get(element);

      if (!key) {
        key = String(++nextKey);
        keys.set(element, key);
      }

      entries.set(element, createPortal(content, element, key));
      publish();
    },
    remove(element: HTMLElement) {
      if (entries.delete(element)) publish();
    },
    commit(value: readonly ReactPortal[]) {
      committed = value;

      if (committed === snapshot) settle();
    },
    whenCommitted() {
      if (committed === snapshot) return Promise.resolve();

      return new Promise<void>((resolve) => pending.add(resolve));
    },
  };

  return host;
}

export function portalHostFor(element: HTMLElement) {
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const host = hosts.get(parent);

    if (host) return host;
  }

  throw new Error('React node views require EditorContent');
}

/** Portals remain children of the application's providers and error boundaries. */
export function EditorPortals({ host }: { host: ReturnType<typeof createPortalHost> }) {
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot);
  useLayoutEffect(() => host.commit(snapshot), [host, snapshot]);

  return snapshot;
}
