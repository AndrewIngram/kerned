import { defineCommand, type CommandContext } from '@gprose/core';
import { paragraph, quote, type TextReplacementRange } from '@gprose/extension-document';
import { boundaries, childrenAt, indexTree, type NodeIdentity } from '@gprose/model';
import {
  AllSelection,
  NodeSelection,
  RangeSelection,
  TextSelection,
  selectionContext,
  textSelection,
} from '@gprose/state';

import { replaceStructuredText } from './blocks.js';
import { pasteFragment } from './clipboard-fragment.js';
import { pasteParagraphs } from './paste.js';
import { createStructuralPolicies } from './structure.js';

export const replaceSelection = defineCommand({
  execute(context, text: string) {
    const { schema } = context;
    const current = context.state;
    const selectionContextValue = selectionContext(schema, current.nodes);
    const selection = current.selection;

    const needsParagraphs =
      text &&
      (selection instanceof NodeSelection ||
        selection instanceof AllSelection ||
        (selection instanceof RangeSelection &&
          (!selection.ranges(selectionContextValue).some((range) => range.kind === 'text') ||
            text.includes('\n'))));

    const change = needsParagraphs
      ? pasteFragment(
          schema,
          current,
          {
            inline: false,
            nodes: text
              .split(/\r?\n/)
              .map((value) => schema.node(paragraph).create(context.allocate(), { text: value })),
          },
          () => context.allocate(),
        )
      : selection instanceof RangeSelection ||
          (selection instanceof TextSelection && selection.anchor.id !== selection.head.id)
        ? replaceStructuredText(schema, current, text)
        : selection.replace(selectionContextValue, text);

    context.apply(change);

    return true;
  },
});

/** Native input may replace a textarea diff range within the currently selected text node. */
export const insertText = defineCommand({
  execute(context, text: string, range?: TextReplacementRange) {
    const { schema, state } = context;
    const selection = state.selection;

    if (!(selection instanceof TextSelection)) return context.command(replaceSelection, text);

    const change =
      selection.anchor.id !== selection.head.id
        ? replaceStructuredText(schema, state, text)
        : {
            steps: [
              {
                kind: 'replaceText' as const,
                id: selection.head.id,
                from: range?.from ?? Math.min(selection.anchor.offset, selection.head.offset),
                to: range?.to ?? Math.max(selection.anchor.offset, selection.head.offset),
                text,
              },
            ],
            selection: textSelection(
              selection.head.id,
              (range?.from ?? Math.min(selection.anchor.offset, selection.head.offset)) +
                text.length,
            ),
          };

    if (!(change.selection instanceof TextSelection))
      throw new Error('Text insertion requires a caret');
    context.apply({ ...change, selection: change.selection, input: true });

    return true;
  },
});

export const pasteText = defineCommand({
  execute(context, text: string) {
    if (!(context.state.selection instanceof TextSelection))
      return context.command(replaceSelection, text);
    context.apply(pasteParagraphs(context.schema, context.state, text, context.allocate));

    return true;
  },
});

/** Enter uses schema text/split policies and the starter container definitions. */
export const splitBlock = defineCommand({
  execute(context) {
    if (!(context.state.selection instanceof TextSelection)) return false;
    const initial = context.state.selection;

    if (initial.anchor.id !== initial.head.id || initial.anchor.offset !== initial.head.offset)
      if (!context.command(replaceSelection, '')) return false;
    const { schema, state } = context;
    const selection = state.selection;

    if (!(selection instanceof TextSelection)) return false;
    const tree = indexTree(schema, state.nodes);
    const entry = tree.byId.get(selection.head.id);
    const text = entry ? schema.text(entry.node) : null;

    if (!entry || text === null) return false;
    const parent = entry.parent === null ? undefined : tree.byId.get(entry.parent)?.node;
    const policy = createStructuralPolicies(schema);

    if (parent && policy.itemType.matches(parent)) {
      const change = policy.lists.enter(
        schema,
        state,
        entry.node.id,
        selection.head.offset,
        context.allocate,
      );

      const nextSelection = change.selection ?? selection;

      if (!(nextSelection instanceof TextSelection))
        throw new Error('List splitting requires a caret');
      context.apply({ ...change, selection: nextSelection, input: true });

      return true;
    }

    if (text === '' && parent && schema.node(quote).matches(parent)) {
      context.step({ kind: 'unwrap', id: parent.id });

      return true;
    }

    const right = context.allocate();
    context.apply({
      steps: [
        {
          kind: 'split',
          id: entry.node.id,
          at: selection.head.offset,
          rightId: right.id,
          rightKey: right.key,
        },
      ],
      selection: textSelection(right.id, 0),
      input: true,
    });

    return true;
  },
});

function deleteText<N extends NodeIdentity>(context: CommandContext<N>, backward: boolean) {
  const { schema, state } = context;
  const selection = state.selection;

  if (
    !(selection instanceof TextSelection) ||
    selection.anchor.id !== selection.head.id ||
    selection.anchor.offset !== selection.head.offset
  )
    return context.command(replaceSelection, '');
  const tree = indexTree(schema, state.nodes);
  const entry = tree.byId.get(selection.head.id);
  const text = entry ? schema.text(entry.node) : null;

  if (!entry || text === null) return false;
  const at = selection.head.offset;
  const stops = boundaries(text);
  const index = stops.indexOf(at);
  const other = stops[Math.max(0, Math.min(stops.length - 1, index + (backward ? -1 : 1)))];

  if (other !== at) {
    const from = Math.min(at, other);
    context.apply({
      steps: [{ kind: 'replaceText', id: entry.node.id, from, to: Math.max(at, other), text: '' }],
      selection: textSelection(entry.node.id, from),
      input: true,
    });

    return true;
  }

  const parent = entry.parent === null ? undefined : tree.byId.get(entry.parent)?.node;
  const policy = createStructuralPolicies(schema);

  if (backward && entry.index === 0 && parent && policy.itemType.matches(parent)) {
    context.apply(policy.lists.backspace(schema, state, entry.node.id, context.allocate));

    return true;
  }

  const siblings = childrenAt(schema, state.nodes, entry.parent);
  const neighbour = siblings[entry.index + (backward ? -1 : 1)];

  if (!neighbour || schema.text(neighbour) === null) return false;
  const left = backward ? neighbour : entry.node;
  const right = backward ? entry.node : neighbour;
  const offset = schema.text(left)?.length ?? 0;
  context.apply({
    steps: [{ kind: 'join', left: left.id, right: right.id }],
    selection: textSelection(left.id, offset),
  });

  return true;
}

export const deleteBackward = defineCommand({ execute: (context) => deleteText(context, true) });

export const deleteForward = defineCommand({ execute: (context) => deleteText(context, false) });
