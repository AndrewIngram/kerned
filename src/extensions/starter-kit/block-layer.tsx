import { type CanvasKit } from 'canvaskit-wasm';
import { useMemo, type ComponentProps } from 'react';

import type { BrowserViewOptions } from '../../editor-browser';
import type { Viewport } from '../../editor-react';
import { demoSchema } from '../../extensions/demo-schema';
import { DemoNodeView } from '../../extensions/node-views';
import { type CommentHighlight } from '../../extensions/text-block-view';
import { type FindState, type Selection } from '../../state';
import type { StarterNode } from '../demo-model';
import type { EditorDocument } from './document';
import type { DocumentLayout, DocumentLayoutSnapshot } from './document-layout';
import type { InputActions } from './input';
import type { Owned } from './types';

type BlockLayerProps = {
  clipboard: Pick<NonNullable<BrowserViewOptions['input']>, 'copy' | 'cut' | 'paste'>;
  doc: EditorDocument;
  actions: Pick<InputActions, 'replaceText' | 'restore' | 'toggleFormat' | 'replaceCells'> & {
    update(this: void, node: StarterNode): boolean;
  };
  layout: DocumentLayoutSnapshot & { onMeasure: DocumentLayout['measure'] };
  viewport: Viewport;
  kit: CanvasKit;
  owned: Owned;
  nodeComments: ReadonlyMap<number, readonly string[]>;
  commentsByNode: ReadonlyMap<number, CommentHighlight[]>;
  findMatches: FindState['byNode'];
  findOpen: boolean;
  findState: FindState;
  setSelection: (selection: Selection) => void;
  setFocusedWidget: (id: number | null) => void;
  onOpen: (kind: 'mention' | 'comment', nodeId: number, atomId: string, index: number) => void;
};

export function BlockLayer({
  doc,
  clipboard,
  actions,
  layout,
  viewport,
  kit,
  owned,
  commentsByNode,
  nodeComments,
  findMatches,
  findOpen,
  findState,
  setSelection,
  setFocusedWidget,
  onOpen,
}: BlockLayerProps) {
  const { projection, editorState, context, selectedRange } = doc;
  const { replaceText, restore, toggleFormat, replaceCells, update } = actions;
  const { visible, contentWidth, onMeasure, scene } = layout;
  const { width, zoom } = viewport;
  const quoteRules = new Map<number, { top: number; bottom: number; left: number }>();

  for (const p of visible)
    for (const quote of projection.decorations.get(p.node.id)?.quotes ?? []) {
      const prior = quoteRules.get(quote.id);
      quoteRules.set(quote.id, {
        top: prior?.top ?? p.y,
        bottom: p.y + p.height,
        left: quote.inset,
      });
    }

  const values = useMemo(
    () =>
      visible.map((p): ComponentProps<typeof DemoNodeView>['value'] => ({
        node: p.node,
        table: {
          clipboard,
          findMatches,
          activeMatch: findOpen ? findState.active : null,
          width: contentWidth,
          onMeasure,
          selection: editorState.selection,
          context,
          onSelect: setSelection,
          onText: replaceText,
          onUndo: restore,
          onFormat: toggleFormat,
          onReplace: replaceCells,
        },
        image: { width: contentWidth, onMeasure },
        checklist: { width: contentWidth, onMeasure, onChange: update },
        text: {
          comments: commentsByNode.get(p.node.id),
          placement: p,
          kit,
          owned,
          open: (kind, atomId, index) => onOpen(kind, p.node.id, atomId, index),
        },
      })),
    [
      visible,
      clipboard,
      findMatches,
      findOpen,
      findState.active,
      contentWidth,
      onMeasure,
      editorState.selection,
      context,
      setSelection,
      replaceText,
      restore,
      toggleFormat,
      replaceCells,
      update,
      commentsByNode,
      kit,
      owned,
      onOpen,
    ],
  );

  return (
    <div
      className="dom-layer"
      style={{ width: width / zoom, height: scene.height, transform: `scale(${zoom})` }}
    >
      {[...quoteRules].map(([id, rule]) => (
        <span
          key={`quote-${id}`}
          data-quote={id}
          className="quote-rule"
          style={{
            left: 28 + rule.left,
            top: rule.top,
            bottom: 'auto',
            height: rule.bottom - rule.top,
            pointerEvents: 'none',
          }}
        />
      ))}
      {visible.map((p) => {
        const d = projection.decorations.get(p.node.id);

        return d?.marker ? (
          <div
            key={`structure-${p.node.id}`}
            className="block-decoration"
            data-block-decoration={p.node.id}
            style={{ left: 28, top: p.y, height: p.height, width: d.inset }}
          >
            <span className="list-marker">{d.marker}</span>
          </div>
        ) : null;
      })}
      {visible.map((p, index) => {
        const view = (
          <DemoNodeView
            key={p.node.id}
            type={demoSchema.resolve(p.node).name}
            value={values[index]}
          />
        );

        return demoSchema.resolve(p.node).kind === 'text' ? (
          view
        ) : (
          <div
            key={p.node.id}
            className="block-position"
            data-editor-node={p.node.id}
            data-selected={!!selectedRange(p.node)}
            data-commented={!!nodeComments.get(p.node.id)?.length}
            onPointerDownCapture={(event) => {
              if (
                event.target instanceof Element &&
                event.target.closest('button,input,a,textarea,select,[data-editor-interactive]')
              )
                return;
              const comment = nodeComments.get(p.node.id)?.[0];

              if (comment) onOpen('comment', p.node.id, comment, 0);
            }}
            style={{ left: 28, top: p.y, width: contentWidth }}
            onFocusCapture={() => setFocusedWidget(p.node.id)}
            onBlurCapture={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setFocusedWidget(null);
            }}
          >
            {view}
          </div>
        );
      })}
    </div>
  );
}
