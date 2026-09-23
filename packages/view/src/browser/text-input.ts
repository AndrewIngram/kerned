import { snapTextOffset, type NodeIdentity, type Schema } from '@kerned/model';
import {
  TextSelection,
  selectionContext,
  type EditorState,
  type SelectionContext,
  type Selection,
  type NodeAccess,
} from '@kerned/state';

type InputSession<N extends NodeIdentity> = {
  readonly state: EditorState<N>;
  breakHistory(): void;
  getAccess?(id: number): NodeAccess | undefined;
};

/** Native textarea capture independent of React, schema names and rendering. */
export function createTextInput<N extends NodeIdentity>(
  schema: Schema<N>,
  editor: InputSession<N>,
  readContext?: () => SelectionContext,
) {
  let capture = { value: '', offset: 0 },
    composing = false,
    frame = 0;

  let capturedSelection: Selection | undefined;
  let discardedComposition = false;

  let mirrored: { selection: TextSelection; value: string } | undefined;

  let cached: { nodes: readonly N[]; context: SelectionContext } | undefined;
  let destroyed = false;
  let detach: (() => void) | undefined;

  function assertActive() {
    if (destroyed) throw new Error('Text input is destroyed');
  }

  function context() {
    if (readContext) return readContext();

    if (cached?.nodes !== editor.state.nodes)
      cached = { nodes: editor.state.nodes, context: selectionContext(schema, editor.state.nodes) };

    return cached.context;
  }

  function sync(input: HTMLTextAreaElement) {
    assertActive();
    const { selection } = editor.state;

    const access =
      selection instanceof TextSelection && editor.getAccess
        ? editor.getAccess(selection.head.id)
        : 'editable';

    if (composing) {
      if (capturedSelection?.eq(selection) && access === 'editable') return;
      discardedComposition = true;
      composing = false;
    }

    mirrored = undefined;
    capturedSelection = selection;

    if (access === 'protected' || !access) {
      discardedComposition ||= composing;
      composing = false;
      input.value = '';
      input.setSelectionRange(0, 0);
      capture = { value: '', offset: 0 };

      return;
    }

    if (!(selection instanceof TextSelection)) {
      input.value = '';
      input.setSelectionRange(0, 0);
      capture = { value: '', offset: 0 };

      return;
    }

    const current = context(),
      { anchor, head } = selection;

    if (anchor.id !== head.id) {
      const order = current.order(),
        a = order.findIndex((node) => node.id === anchor.id),
        b = order.findIndex((node) => node.id === head.id);

      input.value = '';
      input.setSelectionRange(0, 0);
      capture = { value: '', offset: (a < b ? anchor : head).offset };
    } else {
      const text = current.text(head.id);

      if (text === null) return;
      input.value = text;
      input.setSelectionRange(
        Math.min(anchor.offset, head.offset),
        Math.max(anchor.offset, head.offset),
        anchor.offset > head.offset ? 'backward' : 'forward',
      );
      capture = { value: text, offset: 0 };
      mirrored = { selection, value: text };
    }
  }

  return {
    get composing() {
      return composing;
    },
    sync,
    compositionStart(this: void) {
      assertActive();
      cancelAnimationFrame(frame);
      editor.breakHistory();
      discardedComposition = false;
      composing = true;
    },
    compositionEnd(input: HTMLTextAreaElement | null, onCommit?: () => void) {
      assertActive();
      composing = false;
      editor.breakHistory();
      cancelAnimationFrame(frame);

      if (input)
        frame = requestAnimationFrame(() => {
          if (
            !destroyed &&
            !discardedComposition &&
            capturedSelection?.eq(editor.state.selection) &&
            (!(editor.state.selection instanceof TextSelection) ||
              !editor.getAccess ||
              editor.getAccess(editor.state.selection.head.id) === 'editable')
          )
            onCommit?.();
          discardedComposition = false;

          if (!destroyed) sync(input);
        });
    },
    read(input: HTMLTextAreaElement, replace: (from: number, to: number, text: string) => void) {
      assertActive();
      const selection = editor.state.selection;

      const access =
        selection instanceof TextSelection && editor.getAccess
          ? editor.getAccess(selection.head.id)
          : 'editable';

      if (
        discardedComposition ||
        access !== 'editable' ||
        (capturedSelection && !selection.eq(capturedSelection))
      ) {
        discardedComposition ||= composing;
        composing = false;
        sync(input);

        return;
      }

      const apply = (from: number, to: number, text: string) => {
        replace(from, to, text);
        capturedSelection = editor.state.selection;
      };

      if (!(selection instanceof TextSelection)) {
        const value = input.value;
        input.value = '';
        capture = { value: '', offset: 0 };
        apply(0, 0, value);

        return;
      }

      const value = input.value,
        old = capture.value,
        offset = capture.offset,
        { anchor, head } = selection;

      capture = { value, offset };

      if (anchor.id === head.id && anchor.offset !== head.offset) {
        const start = Math.min(anchor.offset, head.offset),
          end = Math.max(anchor.offset, head.offset);

        apply(start, end, value.slice(start, value.length - (old.length - end)));

        return;
      }

      let from = 0;

      while (from < old.length && from < value.length && old[from] === value[from]) from++;

      let to = old.length,
        end = value.length;

      while (to > from && end > from && old[to - 1] === value[end - 1]) {
        to--;
        end--;
      }

      if (from === to && from === end) return;
      apply(offset + from, offset + to, value.slice(from, end));
    },
    /** Observe native/assistive selection changes, including Safari Select All. */
    mount(
      input: HTMLTextAreaElement,
      onSelectAll: () => void,
      onSelect?: (selection: TextSelection) => void,
    ) {
      assertActive();

      if (detach) throw new Error('Text input is already mounted');

      const select = () => {
        const selection = editor.state.selection;

        if (
          composing ||
          discardedComposition ||
          !mirrored ||
          input.value !== mirrored.value ||
          !(selection instanceof TextSelection) ||
          selection.anchor.id !== selection.head.id ||
          !selection.eq(mirrored.selection) ||
          context().text(selection.head.id) !== mirrored.value
        )
          return;

        const from = snapTextOffset(input.value, input.selectionStart, -1);

        const to =
          input.selectionStart === input.selectionEnd
            ? from
            : snapTextOffset(input.value, input.selectionEnd, 1);

        const backward = input.selectionDirection === 'backward';
        const anchor = backward ? to : from;
        const head = backward ? from : to;

        // Setters queue selection events. Compare values, not a synchronous flag.
        if (selection.anchor.offset === anchor && selection.head.offset === head) return;

        if (
          input.value &&
          from === 0 &&
          to === input.value.length &&
          (Math.min(selection.anchor.offset, selection.head.offset) !== 0 ||
            Math.max(selection.anchor.offset, selection.head.offset) !== input.value.length)
        ) {
          mirrored = undefined;
          onSelectAll();
        } else {
          const next = new TextSelection(
            { id: selection.head.id, offset: anchor },
            { id: selection.head.id, offset: head },
          );

          mirrored = { selection: next, value: input.value };
          onSelect?.(next);
          capturedSelection = editor.state.selection;
        }
      };

      const selectionChanged = () => {
        if (input.ownerDocument.activeElement === input) select();
      };

      input.addEventListener('select', select);
      input.ownerDocument.addEventListener('selectionchange', selectionChanged);

      const cleanup = () => {
        if (detach !== cleanup) return;
        detach = undefined;
        input.removeEventListener('select', select);
        input.ownerDocument.removeEventListener('selectionchange', selectionChanged);
        cancelAnimationFrame(frame);
        composing = false;
        capture = { value: '', offset: 0 };
        capturedSelection = undefined;
        discardedComposition = false;
        mirrored = undefined;
        cached = undefined;
      };

      detach = cleanup;

      return cleanup;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      detach?.();
      cancelAnimationFrame(frame);
      composing = false;
      capture = { value: '', offset: 0 };
      cached = undefined;
      capturedSelection = undefined;
      mirrored = undefined;
      discardedComposition = false;
    },
  };
}
