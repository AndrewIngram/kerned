import type { MountedEditor, ViewSnapshot } from '@gprose/view';
import { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { EditorDocument } from '../document-query.js';
import type { useComments } from './use-comments';

const TeamContext = createContext('');

function MentionDetails() {
  const team = useContext(TeamContext);

  return (
    <>
      <strong>Maya Chen</strong>
      <p>Product designer · {team}</p>
    </>
  );
}

export type ActivePanel = {
  kind: 'mention' | 'comment';
  nodeId: number;
  atomId: string;
  focus: 'text' | 'panel';
};

type PanelProps = Pick<
  ReturnType<typeof useComments>,
  'comments' | 'commentState' | 'decorations'
> & {
  panel: ActivePanel | null;
  view: MountedEditor | null;
  geometry: ViewSnapshot | null;
  doc: EditorDocument;
  minimal: boolean;
  onClose: () => void;
};

export function AnnotationPanel({
  panel,
  view,
  geometry,
  doc,
  comments,
  commentState,
  decorations,
  minimal,
  onClose,
}: PanelProps) {
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const panelThread = commentState.threads.find((thread) => thread.id === panel?.atomId);

  const panelRanges = decorations.resolved.find(
    (decoration) => decoration.id === panel?.atomId,
  )?.ranges;

  const panelRange =
    panelRanges?.find((range) => range.id === panel?.nodeId && view?.blockBounds(range.id)) ??
    panelRanges?.find((range) => view?.blockBounds(range.id));

  let panelRect: { left: number; top: number; bottom: number } | null = null;

  if (panel && view && geometry) {
    if (panel.kind === 'mention') {
      const node = doc.tree.byId.get(panel.nodeId)?.node;

      const inline =
        node && (node.kind === 'paragraph' || node.kind === 'heading')
          ? node.inline.find((value) => value.id === panel.atomId)
          : undefined;

      if (inline) panelRect = view.coordsAt({ id: panel.nodeId, offset: inline.index });
    } else if (panelRange?.kind === 'text') {
      panelRect = view.coordsAt({ id: panelRange.id, offset: panelRange.from });
    } else if (panelRange) {
      const bounds = view.blockBounds(panelRange.id, 'client');

      if (bounds) panelRect = { ...bounds, bottom: bounds.top + bounds.height };
    }
  }

  const origin = portal?.getBoundingClientRect();
  const viewportTop = minimal ? 0 : (origin?.top ?? 0);

  const viewportBottom = minimal
    ? window.innerHeight
    : viewportTop + (geometry?.viewport.height ?? 0) * (geometry?.zoom ?? 1);

  useEffect(() => {
    if (panel?.focus === 'panel')
      portal?.querySelector<HTMLButtonElement>('.close-panel')?.focus({ preventScroll: true });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Changing the annotation target must refocus the existing panel.
  }, [panel?.kind, panel?.nodeId, panel?.atomId, panel?.focus, portal]);

  return (
    <TeamContext.Provider value="Design team">
      <div className="panel-layer" ref={setPortal} />
      {portal &&
        panel &&
        panelRect &&
        origin &&
        panelRect.bottom >= viewportTop &&
        panelRect.top <= viewportBottom &&
        createPortal(
          <div
            className="nearby-panel"
            role="dialog"
            aria-label={panel.kind === 'mention' ? 'Mention details' : 'Comment'}
            style={{
              left: Math.max(8, Math.min(panelRect.left - origin.left, origin.width - 294)),
              top:
                Math.max(viewportTop + 8, Math.min(panelRect.bottom + 8, viewportTop + 290)) -
                origin.top,
            }}
          >
            <button className="close-panel" onClick={onClose}>
              Close
            </button>
            {panel.kind === 'mention' ? (
              <MentionDetails />
            ) : (
              <>
                <strong>Comment</strong>
                {panelThread?.messages[0]?.body && <p>{panelThread.messages[0].body}</p>}
                <label>
                  Reply
                  <textarea
                    value={panelThread?.messages[0]?.reply ?? ''}
                    onChange={(e) => {
                      if (panelThread)
                        comments.put({
                          ...panelThread,
                          messages: [
                            { body: panelThread.messages[0]?.body ?? '', reply: e.target.value },
                          ],
                        });
                    }}
                  />
                </label>
              </>
            )}
          </div>,
          portal,
        )}
    </TeamContext.Provider>
  );
}
