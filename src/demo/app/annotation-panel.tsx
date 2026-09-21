import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Rect } from '../../engines';
import { type Scene } from '../../editor-scene';

import type { Viewport } from '../../editor-react';
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
  scene: Scene;
  viewport: Viewport;
  minimal: boolean;
  onClose: () => void;
};

export function AnnotationPanel({
  panel,
  scene,
  comments,
  commentState,
  decorations,
  viewport,
  minimal,
  onClose,
}: PanelProps) {
  const { zoom, scroll, width, viewportHeight } = viewport;
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const panelThread = commentState.threads.find((thread) => thread.id === panel?.atomId);

  const panelRanges = decorations.resolved.find(
    (decoration) => decoration.id === panel?.atomId,
  )?.ranges;

  const placements = useMemo(
    () => new Map(scene.placements.map((p) => [p.node.id, p])),
    [scene.placements],
  );

  const panelRange =
    panelRanges?.find((range) => range.id === panel?.nodeId && placements.has(range.id)) ??
    panelRanges?.find((range) => placements.has(range.id));

  const panelPlacement = placements.get(
    panel?.kind === 'comment' ? (panelRange?.id ?? -1) : (panel?.nodeId ?? -1),
  );

  let panelRect: Rect | null = null;

  if (panel && panelPlacement) {
    if (panel.kind === 'mention') {
      const box = panelPlacement.boxes.find((b) => b.id === panel.atomId);

      if (box)
        panelRect = [
          box.x,
          box.y + panelPlacement.y,
          box.x + box.width,
          box.y + box.height + panelPlacement.y,
        ];
    } else if (
      (panelPlacement.node.kind === 'paragraph' || panelPlacement.node.kind === 'heading') &&
      panelPlacement.layout
    ) {
      const r =
        panelRange?.kind === 'text' &&
        panelPlacement.layout.geometry(panelRange.from, panelRange.to, false).rects[0];

      if (r) panelRect = [r[0], r[1] + panelPlacement.y, r[2], r[3] + panelPlacement.y];
    } else if (panel.kind === 'comment') {
      panelRect = [
        28,
        panelPlacement.y,
        width / zoom - 28,
        panelPlacement.y + panelPlacement.height,
      ];
    }
  }

  useEffect(() => {
    if (panel?.focus === 'panel')
      portal?.querySelector<HTMLButtonElement>('.close-panel')?.focus({ preventScroll: true });
  }, [panel?.kind, panel?.nodeId, panel?.atomId, panel?.focus, portal]);

  return (
    <TeamContext.Provider value="Design team">
      <div className="panel-layer" ref={setPortal} />
      {portal &&
        panel &&
        panelRect &&
        panelRect[3] * zoom - scroll >= 0 &&
        panelRect[1] * zoom - scroll <= viewportHeight &&
        createPortal(
          <div
            className="nearby-panel"
            role="dialog"
            aria-label={panel.kind === 'mention' ? 'Mention details' : 'Comment'}
            style={{
              left: Math.max(8, Math.min((panelRect[0] + 28) * zoom, width - 294)),
              top:
                (minimal ? scroll : 0) +
                Math.max(8, Math.min(panelRect[3] * zoom - scroll + 8, 290)),
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
