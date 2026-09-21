import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';

import type { Scene } from '../../editor-canvas/scene';
import type { Viewport } from '../../editor-react';
import type { StarterLeaf } from '../../extensions/demo-model';
import type { EditorSession } from '../../extensions/starter-kit/types';
import type { FindOptions, FindState } from '../../state';

export function useFind({
  editor,
  scroller,
  inputRef,
  onOpen,
}: {
  editor: EditorSession;
  scroller: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onOpen: () => void;
}) {
  const [findOpen, setFindOpen] = useState(false),
    [findRequest, setFindRequest] = useState(0),
    [findFocus, setFindFocus] = useState(0);

  const lastQuery = useRef(''),
    returnFocus = useRef<HTMLElement | null>(null);

  const lastFindOptions = useRef<FindOptions>({ matchCase: false });
  const readResults = useCallback(() => editor.find.getSnapshot().state, [editor]);
  const findState = useSyncExternalStore(editor.find.subscribe, readResults);
  const findStale = editor.find.getSnapshot().stale;

  const findRef = useRef(findState);
  useLayoutEffect(() => {
    findRef.current = findState;
  }, [findState]);

  const requestFind = useCallback(
    (query: string, options: FindOptions) => {
      lastQuery.current = query;
      lastFindOptions.current = options;
      void editor.find.setQueryAsync(query, options);
    },
    [editor],
  );

  useEffect(() => {
    if (!findOpen) return;
    requestFind(lastQuery.current, lastFindOptions.current);
  }, [findOpen, requestFind]);

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
    editor.find.clear();
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
    if (backwards) editor.find.previous();
    else editor.find.next();
    setFindRequest((n) => n + 1);
  }

  return {
    findOpen,
    findState,
    findStale,
    findRef,
    findRequest,
    findFocus,
    lastQuery,
    lastFindOptions,
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
  scroller,
  canvasRef,
  viewport,
}: {
  scene: Scene<StarterLeaf>;
  findOpen: boolean;
  findState: FindState;
  findRequest: number;
  findBlockId: number | undefined;
  scroller: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  viewport: Viewport;
}) {
  const revealFind = useRef(false);
  const { zoom, viewportHeight, readScroll, scrollDocumentTo } = viewport;
  useLayoutEffect(() => {
    revealFind.current = true;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Each find request or active-match change must rearm viewport reveal.
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
        viewportValue = canvasRef.current?.getBoundingClientRect();

      if (!viewportValue) return;
      matchTop = rect.top - viewportValue.top + readScroll();
      matchBottom = rect.bottom - viewportValue.top + readScroll();
    }

    revealFind.current = false;

    const scrollTop = readScroll(),
      clearance = 64;

    if (matchTop < scrollTop + clearance || matchBottom > scrollTop + viewportHeight - 24) {
      scrollDocumentTo(Math.max(0, matchTop - Math.max(clearance, viewportHeight * 0.35)));
    }
  }, [
    scene,
    findOpen,
    findState.active,
    findBlockId,
    zoom,
    viewportHeight,
    scroller,
    canvasRef,
    readScroll,
    scrollDocumentTo,
  ]);
}
