import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';

import type { MountedEditor } from '../../editor-canvas';
import type { EditorSession } from '../../extensions/starter-kit/types';
import type { FindOptions, FindState } from '../../state';

export function useFind({
  editor,
  scroller,
  view,
  onOpen,
}: {
  editor: EditorSession;
  scroller: RefObject<HTMLDivElement | null>;
  view: MountedEditor | null;
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
    else view?.focus();
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
  view,
  findOpen,
  findState,
  findRequest,
}: {
  view: MountedEditor | null;
  findOpen: boolean;
  findState: FindState;
  findRequest: number;
}) {
  useLayoutEffect(() => {
    if (view && findOpen && findState.active)
      void view.reveal({ id: findState.active.id, offset: findState.active.from }, { margin: 64 });
    // Each explicit next/previous request should reveal even if there is only one match.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [view, findOpen, findState.active, findRequest]);
}
