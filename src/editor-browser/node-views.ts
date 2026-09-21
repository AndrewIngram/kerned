import { defineContribution } from '../core';
import type { NodeBinding, SchemaDefinition, NodeIdentity, TextPoint } from '../model';
import type { Selection, SelectionContext } from '../state';
import type { ViewSession } from './input-contributions';
import { createTextDecorations, type ReadTextDecorations } from './text-decorations';
import type { ReadTextStyle } from './text-style';

export type NodeViewEnvironment = {
  clipboard: (event: ClipboardEvent) => void;
  notice: (message: string) => void;
  onError?: (error: Error) => void;
};

export type NodeViewContext<N extends NodeIdentity> = NodeViewEnvironment & {
  readonly editor: ViewSession<N>;
};

type NodeDefinition = Extract<SchemaDefinition, { category: 'node' }>;

export type NodeViewFrame<N> = {
  node: N;
  selection: Selection;
  context: SelectionContext;
  width: number;
  textDecorations?: ReadTextDecorations;
  textStyle?: ReadTextStyle;
  onMeasure: (id: number, width: number, height: number) => void;
};

export type NodeView<N> = {
  readonly isDestroyed: boolean;
  update(frame: NodeViewFrame<N>): void;
  focusSelection?(selection: Selection): boolean;
  coordsAt?(point: TextPoint): DOMRect | null;
  /** Reveal within the node's own scrollports, without moving document scroll or focus. */
  reveal?(point: TextPoint): void;
  destroy(): void;
};

type NodeViewRenderer<N> = {
  readonly name: string;
  matches(this: void, node: N): boolean;
  mount(element: HTMLDivElement): Omit<NodeView<N>, 'isDestroyed'>;
};

type MountedNodeRenderer<N> = Omit<NodeViewRenderer<N>, 'mount'> & {
  readonly isDestroyed: boolean;
  mount(element: HTMLDivElement): NodeView<N>;
};

export type NodeViewContribution = {
  create<N extends NodeIdentity>(context: NodeViewContext<N>): NodeViewRenderer<N>;
};

/** The browser contract is defined here; the headless session only stores typed values. */
export const nodeViews = defineContribution<NodeViewContribution>();

export type NodeViewAttributes<Definition extends NodeDefinition> = NonNullable<
  ReturnType<NodeBinding<NodeIdentity, Definition>['read']>
>;

/** A renderer binds to an installed definition family, including configured variants.
 * The factory owns per-view caches; each mounted node owns its DOM and cleanup.
 */
export function defineNodeView<Definition extends NodeDefinition>(
  definition: Definition,
  createRenderer: <N extends NodeIdentity>(
    context: NodeViewContext<N>,
  ) => (element: HTMLDivElement) => {
    update(
      frame: NodeViewFrame<NodeIdentity> & { attributes: NodeViewAttributes<Definition> },
    ): void;
    focusSelection?(selection: Selection): boolean;
    coordsAt?(point: TextPoint): DOMRect | null;
    reveal?(point: TextPoint): void;
    destroy(): void;
  },
): NodeViewContribution {
  return {
    create<N extends NodeIdentity>(context: NodeViewContext<N>): NodeViewRenderer<N> {
      const binding = context.editor.schema.node(definition);
      const renderer = createRenderer(context);

      return {
        name: definition.name,
        matches: binding.matches,
        mount(element) {
          const view = renderer(element);

          return {
            update(frame) {
              const attributes = binding.read(frame.node);

              if (!attributes)
                throw new Error(`Node does not match renderer for ${definition.name}`);
              view.update({ ...frame, attributes });
            },
            focusSelection: view.focusSelection
              ? (selection) => view.focusSelection?.(selection) ?? false
              : undefined,
            coordsAt: view.coordsAt ? (point) => view.coordsAt?.(point) ?? null : undefined,
            reveal: view.reveal ? (point) => view.reveal?.(point) : undefined,
            destroy: () => view.destroy(),
          };
        },
      };
    },
  };
}

/** Resolve the session's contributions once per view, without a parallel renderer list. */
export function createNodeViews<N extends NodeIdentity>(
  editor: ViewSession<N>,
  environment: NodeViewEnvironment,
) {
  const renderers = new Map<string, MountedNodeRenderer<N>>();

  for (const contribution of nodeViews.read(editor)) {
    const renderer = contribution.create({ editor, ...environment });

    if (renderers.has(renderer.name)) throw new Error(`Duplicate node renderer: ${renderer.name}`);
    renderers.set(renderer.name, {
      get isDestroyed() {
        return editor.isDestroyed;
      },
      name: renderer.name,
      matches: renderer.matches,
      mount(element) {
        if (editor.isDestroyed) throw new Error('Editor is destroyed');
        const view = renderer.mount(element);
        let destroyed = false;
        let detach: (() => void) | undefined;
        let frame: NodeViewFrame<N> | undefined;
        let frameState = editor.state;
        let scheduled = 0;
        let decorations: ReturnType<typeof createTextDecorations<N>> | undefined;

        function update(next: NodeViewFrame<N>) {
          if (destroyed || editor.isDestroyed) throw new Error('Node view is destroyed');
          cancelAnimationFrame(scheduled);
          scheduled = 0;
          frame = next;
          frameState = editor.state;
          decorations?.begin(next.context);

          try {
            view.update({ ...next, textDecorations: decorations?.read });
          } finally {
            decorations?.end();
          }
        }

        function invalidate() {
          if (destroyed || !frame || scheduled) return;
          scheduled = requestAnimationFrame(() => {
            scheduled = 0;

            if (destroyed || !frame || frameState !== editor.state) return;

            try {
              update(frame);
            } catch (error) {
              if (environment.onError)
                environment.onError(error instanceof Error ? error : new Error(String(error)));
              else throw error;
            }
          });
        }

        function destroy() {
          if (destroyed) return;
          destroyed = true;
          cancelAnimationFrame(scheduled);
          frame = undefined;
          detach?.();
          const errors: unknown[] = [];

          try {
            decorations?.destroy();
          } catch (error) {
            errors.push(error);
          }

          try {
            view.destroy();
          } catch (error) {
            errors.push(error);
          }

          if (errors.length) throw new AggregateError(errors, 'Node view cleanup failed');
        }

        try {
          decorations = createTextDecorations(editor, invalidate);

          if (editor.isDestroyed)
            throw new Error('Editor was destroyed while mounting a node view');
          detach = editor.on('destroy', destroy);
        } catch (error) {
          destroy();
          throw error;
        }

        return {
          get isDestroyed() {
            return destroyed;
          },
          update,
          focusSelection: view.focusSelection
            ? (selection) =>
                !destroyed && !editor.isDestroyed && (view.focusSelection?.(selection) ?? false)
            : undefined,
          coordsAt: view.coordsAt
            ? (point) => (destroyed || editor.isDestroyed ? null : (view.coordsAt?.(point) ?? null))
            : undefined,
          reveal: view.reveal
            ? (point) => {
                if (!destroyed && !editor.isDestroyed) view.reveal?.(point);
              }
            : undefined,
          destroy,
        };
      },
    });
  }

  return {
    find(node: N) {
      if (editor.isDestroyed) throw new Error('Editor is destroyed');
      const renderer = renderers.get(editor.schema.resolve(node).name);

      return renderer?.matches(node) ? renderer : undefined;
    },
  };
}
