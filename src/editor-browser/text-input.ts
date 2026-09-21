import {
  TextSelection,
  selectionContext,
  type NodeIdentity,
  type Schema,
  type EditorState,
  type SelectionContext,
} from '../editor';

type InputSession<N extends NodeIdentity> = {
  readonly state: EditorState<N>;
  breakHistory(): void;
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

  let cached: { nodes: readonly N[]; context: SelectionContext } | undefined;

  function context() {
    if (readContext) return readContext();

    if (cached?.nodes !== editor.state.nodes)
      cached = { nodes: editor.state.nodes, context: selectionContext(schema, editor.state.nodes) };

    return cached.context;
  }

  function sync(input: HTMLTextAreaElement) {
    const { selection } = editor.state;

    if (!(selection instanceof TextSelection)) {
      input.value = '';
      input.setSelectionRange(0, 0);
      capture = {value: '', offset: 0};

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
      );
      capture = { value: text, offset: 0 };
    }
  }

  return {
    get composing() {
      return composing;
    },
    sync,
    compositionStart() {
      editor.breakHistory();
      composing = true;
    },
    compositionEnd(input: HTMLTextAreaElement | null) {
      composing = false;
      editor.breakHistory();
      cancelAnimationFrame(frame);

      if (input) frame = requestAnimationFrame(() => sync(input));
    },
    read(input: HTMLTextAreaElement, replace: (from: number, to: number, text: string) => void) {
      const selection = editor.state.selection;

      if (!(selection instanceof TextSelection)) {
        const value = input.value;
        input.value = '';
        capture = {value: '', offset: 0};
        replace(0, 0, value);

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

        replace(start, end, value.slice(start, value.length - (old.length - end)));

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

      replace(offset + from, offset + to, value.slice(from, end));
    },
    /** Observe Safari's native Select All, which can bypass keydown. */
    mount(input: HTMLTextAreaElement, onSelectAll: () => void) {
      const select = () => {
        const selection = editor.state.selection;

        if (
          composing ||
          !input.value ||
          input.selectionStart !== 0 ||
          input.selectionEnd !== input.value.length ||
          !(selection instanceof TextSelection) ||
          selection.anchor.id !== selection.head.id
        )
          return;

        if (
          Math.min(selection.anchor.offset, selection.head.offset) === 0 &&
          Math.max(selection.anchor.offset, selection.head.offset) === input.value.length
        )
          return;
        onSelectAll();
      };

      input.addEventListener('select', select);

      return () => {
        input.removeEventListener('select', select);
        cancelAnimationFrame(frame);
        composing = false;
      };
    },
  };
}
