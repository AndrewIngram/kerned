import type { NodeIdentity, Schema } from '../model';

/** Offsets use the original text's UTF-16 indices and follow grapheme boundaries. */
export type FindMatch = Readonly<{ id: number; key: string; from: number; to: number }>;

export type FindOptions = Readonly<{ matchCase: boolean }>;

export type FindState = Readonly<{
  query: string;
  matchCase: boolean;
  matches: readonly FindMatch[];
  byNode: ReadonlyMap<number, readonly FindMatch[]>;
  activeIndex: number;
  active: FindMatch | null;
}>;

export type FindSnapshot<N extends NodeIdentity> = Readonly<{
  nodes: readonly N[];
  state: FindState;
}>;

export type FindStatus = Readonly<{ state: FindState; pending: boolean; stale: boolean }>;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

type CachedText = {
  id: number;
  text: string;
  stops: Uint8Array | null | undefined;
  result: { query: string; matchCase: boolean; matches: readonly FindMatch[] } | null;
};

type FindResult = Pick<FindState, 'matches' | 'byNode'> & { live: ReadonlySet<string> };

// A task boundary, not a microtask: input and painting can run between slices.
const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A view-independent find session. Reading state synchronizes with the document;
 * searching and navigation never dispatch transactions or alter selections. */
export function createFindSession<N extends NodeIdentity>(
  schema: Schema<N>,
  readNodes: () => readonly N[],
) {
  let state: FindState = {
    query: '',
    matchCase: false,
    matches: [],
    byNode: new Map(),
    activeIndex: -1,
    active: null,
  };

  let previousNodes: readonly N[] = readNodes();
  let observedNodes = previousNodes;

  let desired: FindOptions & { query: string; signal?: AbortSignal } = {
    query: '',
    matchCase: false,
  };

  let inFlight: { version: number; nodes: readonly N[] } | null = null;
  let destroyed = false;
  let status: FindStatus = { state, pending: false, stale: false };
  const listeners = new Set<() => void>();
  let checkedNodes = previousNodes;
  let checkedResult = previousNodes;
  let stale = false;
  let hidden: { source: FindState; state: FindState } | undefined;

  function assertActive() {
    if (destroyed) throw new Error('Find session is destroyed');
  }

  function notify() {
    const nodes = readNodes();

    if (nodes !== checkedNodes || previousNodes !== checkedResult) {
      checkedNodes = nodes;
      checkedResult = previousNodes;
      stale =
        !!state.query &&
        (previousNodes.length > nodes.length || previousNodes.some((node, i) => node !== nodes[i]));
    }

    const pending = inFlight !== null;

    if (stale && hidden?.source !== state) {
      hidden = {
        source: state,
        state: { ...state, matches: [], byNode: new Map(), activeIndex: -1, active: null },
      };
    }

    const visible = stale && hidden ? hidden.state : state;

    if (!stale) hidden = undefined;

    if (status.state === visible && status.stale === stale && status.pending === pending) return;
    status = { state: visible, stale, pending };
    const pendingListeners = [...listeners];

    for (const listener of pendingListeners) {
      try {
        listener();
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  const cache = new Map<string, CachedText>();
  let request = 0;

  function* search(
    nodes: () => readonly N[],
    query: string,
    matchCase: boolean,
  ): Generator<void, FindResult> {
    const matches: FindMatch[] = [],
      byNode = new Map<number, readonly FindMatch[]>(),
      live = new Set<string>();

    const matcher = new RegExp(
      query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      matchCase ? 'gu' : 'giu',
    );

    function* visit(node: N): Generator<void> {
      const text = schema.text(node);

      if (text !== null) {
        live.add(node.key);
        let entry = cache.get(node.key);

        if (!entry || entry.id !== node.id || entry.text !== text) {
          entry = { id: node.id, text, stops: undefined, result: null };
          cache.set(node.key, entry);
        }

        if (!entry.result || entry.result.query !== query || entry.result.matchCase !== matchCase) {
          const found: FindMatch[] = [];
          matcher.lastIndex = 0;

          for (let match = matcher.exec(text); match; match = matcher.exec(text)) {
            const from = match.index,
              to = from + match[0].length;

            found.push({ id: node.id, key: node.key, from, to });

            if (found.length % 512 === 0) yield;
          }

          if (found.length && entry.stops === undefined) {
            if (/[^\x20-\x7e\n\t]/u.test(text)) {
              // One bit per UTF-16 boundary; reused across queries and formatting.
              // Iteration avoids WebKit's containing() bug before astral text.
              const stops = new Uint8Array(Math.ceil((text.length + 1) / 8));
              let lastYield = 0;

              for (const { index } of graphemes.segment(text)) {
                stops[index >>> 3] |= 1 << (index & 7);

                if (index - lastYield >= 2048) {
                  lastYield = index;
                  yield;
                }
              }

              stops[text.length >>> 3] |= 1 << (text.length & 7);
              entry.stops = stops;
            } else entry.stops = null;
          }

          const stops = entry.stops;
          const valid: FindMatch[] = [];

          if (stops)
            for (let i = 0; i < found.length; i++) {
              const match = found[i];

              if (
                stops[match.from >>> 3] & (1 << (match.from & 7)) &&
                stops[match.to >>> 3] & (1 << (match.to & 7))
              )
                valid.push(match);

              if (i % 512 === 511) yield;
            }

          entry.result = { query, matchCase, matches: stops ? valid : found };
        }

        const found = entry.result.matches;

        if (found.length) byNode.set(node.id, found);

        for (let i = 0; i < found.length; i++) {
          matches.push(found[i]);

          if (i % 512 === 511) yield;
        }
      }

      yield;

      for (const child of schema.children(node)) yield* visit(child);
    }

    if (query) for (let index = 0; index < nodes().length; index++) yield* visit(nodes()[index]);

    return { matches, byNode, live };
  }

  function publish(nodes: readonly N[], query: string, matchCase: boolean, result: FindResult) {
    previousNodes = nodes;
    const { matches, byNode, live } = result;

    if (query) for (const key of cache.keys()) if (!live.has(key)) cache.delete(key);

    if (!query) for (const entry of cache.values()) entry.result = null;
    const sameQuery = query === state.query && matchCase === state.matchCase;

    // Formatting and unrelated edits leave the snapshot stable for subscribers.
    if (
      sameQuery &&
      matches.length === state.matches.length &&
      matches.every((match, i) => match === state.matches[i])
    ) {
      notify();

      return state;
    }

    const old = sameQuery ? state.active : null;

    let index = old
      ? matches.findIndex((m) => m.key === old.key && m.from === old.from && m.to === old.to)
      : -1;

    if (index < 0 && old) {
      let distance = Infinity;
      matches.forEach((match, i) => {
        if (match.key === old.key && Math.abs(match.from - old.from) < distance) {
          index = i;
          distance = Math.abs(match.from - old.from);
        }
      });
    }

    const activeIndex = matches.length
      ? index < 0
        ? Math.min(Math.max(0, sameQuery ? state.activeIndex : 0), matches.length - 1)
        : index
      : -1;

    state = {
      query,
      matchCase,
      matches,
      byNode,
      activeIndex,
      active: matches[activeIndex] ?? null,
    };
    notify();

    return state;
  }

  function sync(query = state.query, matchCase = state.matchCase) {
    const nodes = readNodes();

    if (nodes === previousNodes && query === state.query && matchCase === state.matchCase)
      return state;
    const work = search(() => nodes, query, matchCase);
    let result = work.next();

    while (!result.done) result = work.next();

    return publish(nodes, query, matchCase, result.value);
  }

  function setQuery(query: string, options: Partial<FindOptions> = {}) {
    assertActive();
    request++;
    inFlight = null;
    desired = { query, matchCase: options.matchCase ?? state.matchCase };
    const result = sync(query, desired.matchCase);
    notify();

    return result;
  }

  /** Cancellable, cooperative search. Only complete results for the current
   * document are published. Superseded, aborted, or stale work returns null. */
  async function setQueryAsync(
    query: string,
    options: Partial<FindOptions> = {},
    signal?: AbortSignal,
  ): Promise<FindSnapshot<N> | null> {
    assertActive();

    const version = ++request,
      matchCase = options.matchCase ?? state.matchCase;

    desired = { query, matchCase, signal };

    let nodes = readNodes();
    inFlight = { version, nodes };
    notify();

    const cancelled = () => {
      if (destroyed || signal?.aborted || version !== request) return true;
      const latest = readNodes();

      if (latest !== nodes) {
        if (latest.length < nodes.length || nodes.some((node, i) => node !== latest[i]))
          return true;
        // Loading can append while this job yields. Continue at the next root
        // instead of discarding completed work and rescanning the same prefix.
        nodes = latest;
        inFlight = { version, nodes };
      }

      return false;
    };

    try {
      const work = search(() => nodes, query, matchCase);
      // Even a cold query starts after the urgent input update has committed.
      await yieldTask();

      if (
        !cancelled() &&
        nodes === previousNodes &&
        query === state.query &&
        matchCase === state.matchCase
      )
        return { nodes, state };

      while (!cancelled()) {
        const deadline = performance.now() + 4;

        do {
          const result = work.next();

          if (result.done) {
            inFlight = null;

            return { nodes, state: publish(nodes, query, matchCase, result.value) };
          }
        } while (performance.now() < deadline);

        // oxlint-disable-next-line eslint/no-await-in-loop -- Yield between search batches to keep input responsive and observe cancellation.
        await yieldTask();
      }

      return null;
    } finally {
      if (!destroyed && version === request) {
        inFlight = null;

        desired = signal?.aborted
          ? { query: state.query, matchCase: state.matchCase }
          : { query, matchCase };
        notify();

        // An aborted draft query leaves the last completed query active. If an
        // edit invalidated it, finish refreshing that query without the draft's signal.
        if (version === request && signal?.aborted && status.stale) void refreshQuery();
      }
    }
  }

  function move(direction: 1 | -1) {
    assertActive();
    request++;
    inFlight = null;
    desired = { query: state.query, matchCase: state.matchCase };
    sync();
    const count = state.matches.length;

    if (count) {
      const activeIndex = (state.activeIndex + direction + count) % count;
      state = { ...state, activeIndex, active: state.matches[activeIndex] };
    }

    notify();

    return state;
  }

  const api = {
    get state() {
      if (destroyed) return state;

      return sync();
    },
    /** A stable, nonblocking snapshot. Subscribe for query, navigation and document changes. */
    getSnapshot: () => status,
    subscribe(this: void, listener: () => void) {
      assertActive();
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    setQuery,
    setQueryAsync,
    next: () => move(1),
    previous: () => move(-1),
    clear: () => {
      const empty = setQuery('');
      cache.clear();

      return empty;
    },
  };

  async function refreshQuery() {
    try {
      await setQueryAsync(desired.query, desired, desired.signal);
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      });
    }
  }

  return {
    api,
    refresh(this: void) {
      if (destroyed) return;
      const nodes = readNodes();

      if (nodes === observedNodes) return;
      observedNodes = nodes;

      if (desired.signal?.aborted) {
        request++;
        inFlight = null;
        desired = { query: state.query, matchCase: state.matchCase };
      }

      if (!desired.query && !state.query && !inFlight) {
        previousNodes = nodes;
        notify();

        return;
      }

      if (
        inFlight &&
        inFlight.nodes.length <= nodes.length &&
        inFlight.nodes.every((node, i) => node === nodes[i])
      )
        return;
      void refreshQuery();
    },
    destroy(this: void) {
      if (destroyed) return;
      destroyed = true;
      request++;
      inFlight = null;
      listeners.clear();
      cache.clear();
      previousNodes = [];
      observedNodes = previousNodes;
      checkedNodes = previousNodes;
      checkedResult = previousNodes;
      hidden = undefined;
      status = { ...status, pending: false };
    },
  };
}

/** Standalone matcher. Document owners synchronize by reading state or issuing queries.
 * Editor sessions also own automatic cooperative refresh and destruction. */
export function createFind<N extends NodeIdentity>(
  schema: Schema<N>,
  readNodes: () => readonly N[],
) {
  return createFindSession(schema, readNodes).api;
}

export type EditorFind = ReturnType<typeof createFind>;
