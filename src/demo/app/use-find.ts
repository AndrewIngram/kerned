import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { FindOptions, FindSnapshot, FindState } from '../../editor';
import { type HybridNode } from '../../extensions/demo-model';

import type { RefObject } from 'react';
import type { EditorState } from '../../editor';
import type { Viewport } from '../../editor-react';
import type { EditorSession } from '../../extensions/starter-kit/types';
import type { Scene } from '../../hybrid-scene';

export function useFind({
  editor,
  editorState,
  scroller,
  inputRef,
  onOpen,
}: {
  editor: EditorSession;
  editorState: EditorState<HybridNode>;
  scroller: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onOpen: () => void;
}) {
  const [findOpen, setFindOpen] = useState(false),
    [findRequest, setFindRequest] = useState(0),
    [findFocus, setFindFocus] = useState(0);

  const lastQuery = useRef(''),
    returnFocus = useRef<HTMLElement | null>(null),
    revealFind = useRef(false);

  const lastFindOptions = useRef<FindOptions>({ matchCase: false }),
    findAbort = useRef<AbortController | null>(null);

  const findInFlight = useRef<readonly HybridNode[] | null>(null);

  const [findSnapshot, setFindSnapshot] = useState<FindSnapshot<HybridNode>>(() => ({
    state: editor.find.state,
    nodes: editor.state.nodes,
  }));

  // Appended text cannot invalidate existing ranges. Keep the count and
  // highlights steady while the search catches up with the loading stream.
  const findStale = useMemo(
    () =>
      findSnapshot.nodes.length > editorState.nodes.length ||
      findSnapshot.nodes.some((node, i) => node !== editorState.nodes[i]),
    [findSnapshot.nodes, editorState.nodes],
  );

  const findState = useMemo<FindState>(
    () =>
      findStale
        ? { ...findSnapshot.state, matches: [], byNode: new Map(), activeIndex: -1, active: null }
        : findSnapshot.state,
    [findSnapshot, findStale],
  );

  const findMatches = findState.byNode;
  const findRef = useRef(findState);
  useLayoutEffect(() => {
    findRef.current = findState;
  }, [findState]);

  const requestFind = useCallback(
    (query: string, options: FindOptions) => {
      lastQuery.current = query;
      lastFindOptions.current = options;
      findAbort.current?.abort();
      const controller = new AbortController();
      findAbort.current = controller;
      findInFlight.current = editor.state.nodes;
      void editor.find.setQueryAsync(query, options, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        findInFlight.current = null;

        if (!result) return;
        startTransition(() => setFindSnapshot(result));
      });
    },
    [editor],
  );

  useEffect(() => {
    if (!findOpen) return;
    const inFlight = findInFlight.current;

    if (
      inFlight &&
      inFlight.length <= editorState.nodes.length &&
      inFlight.every((node, i) => node === editorState.nodes[i])
    )
      return;
    requestFind(lastQuery.current, lastFindOptions.current);
  }, [editorState.nodes, findOpen, requestFind]);
  useEffect(() => () => findAbort.current?.abort(), []);

  function openFind() {
    if (!findOpen)
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onOpen();
    setFindOpen(true);
    setFindFocus((n) => n + 1);
    setFindRequest((n) => n + 1);
  }

  function closeFind() {
    findAbort.current?.abort();
    findInFlight.current = null;
    setFindSnapshot({ state: editor.find.clear(), nodes: editor.state.nodes });
    setFindOpen(false);
    const target = returnFocus.current;
    const cell = target?.dataset.textBlock;

    const restore = target?.isConnected
      ? target
      : cell
        ? scroller.current?.querySelector<HTMLElement>(`[data-text-block="${cell}"]`)
        : null;

    if (restore && restore !== document.body) restore.focus({ preventScroll: true });
    else inputRef.current?.focus({ preventScroll: true });
  }

  function moveFind(backwards: boolean) {
    setFindSnapshot({
      state: backwards ? editor.find.previous() : editor.find.next(),
      nodes: editor.state.nodes,
    });
    setFindRequest((n) => n + 1);
  }

  return {
    findOpen,
    findState,
    findMatches,
    findStale,
    findRef,
    findRequest,
    findFocus,
    lastQuery,
    lastFindOptions,
    revealFind,
    requestFind,
    openFind,
    closeFind,
    moveFind,
  };
}

export function useFindReveal({
  scene,
  findOpen,
  findState,
  findRequest,
  findBlockId,
  revealFind,
  scroller,
  canvasRef,
  viewport,
}: {
  scene: Scene;
  findOpen: boolean;
  findState: FindState;
  findRequest: number;
  findBlockId: number | undefined;
  revealFind: RefObject<boolean>;
  scroller: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  viewport: Viewport;
}) {
  const { zoom, viewportHeight, readScroll, scrollDocumentTo, setScroll } = viewport;
  useLayoutEffect(() => {
    revealFind.current = true;
  }, [findOpen, findState.active, findRequest]);
  useLayoutEffect(() => {
    if (!findOpen || !findState.active || !revealFind.current) return;

    const match = findState.active,
      placement = scene.placements.find((p) => p.node.id === findBlockId);

    if (!placement) return;
    let matchTop: number, matchBottom: number;

    if (placement.layout) {
      const rect = placement.layout.geometry(match.from, match.to, false).rects[0];

      if (!rect) return;
      matchTop = (placement.y + rect[1]) * zoom;
      matchBottom = (placement.y + rect[3]) * zoom;
    } else {
      const mark = scroller.current?.querySelector<HTMLElement>('[data-find-active="true"]');

      if (!mark) return;
      // Bring horizontally overflowing table cells into their own scrollport.
      const table = mark.closest('.table-block');

      if (table) {
        const a = mark.getBoundingClientRect(),
          b = table.getBoundingClientRect();

        if (a.left < b.left || a.right > b.right) table.scrollLeft += (a.left - b.left) / zoom - 20;
      }

      const rect = mark.getBoundingClientRect(),
        viewport = canvasRef.current?.getBoundingClientRect();

      if (!viewport) return;
      matchTop = rect.top - viewport.top + readScroll();
      matchBottom = rect.bottom - viewport.top + readScroll();
    }

    revealFind.current = false;

    const scrollTop = readScroll(),
      clearance = 64;

    if (matchTop < scrollTop + clearance || matchBottom > scrollTop + viewportHeight - 24) {
      scrollDocumentTo(Math.max(0, matchTop - Math.max(clearance, viewportHeight * 0.35)));
      setScroll(readScroll());
    }
  }, [scene, findOpen, findState.active, findRequest, findBlockId, zoom, viewportHeight]);
}
