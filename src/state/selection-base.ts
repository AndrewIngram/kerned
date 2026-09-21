import type { SelectionRange } from '../model';
import type {
  SelectionContext,
  SelectionContent,
  SelectionFragment,
  SelectionBookmark,
  SelectionJSON,
  SelectionEdit,
  SelectionMapping,
} from './selection';

/** Runtime protocol. Codecs are only used when crossing a persistence boundary. */
export abstract class Selection {
  abstract readonly type: string;
  abstract eq(other: Selection): boolean;
  abstract validate(context: SelectionContext): void;
  abstract ranges(context: SelectionContext): readonly SelectionRange[];
  isEmpty(context: SelectionContext): boolean {
    return this.ranges(context).every((range) => range.kind === 'text' && range.from === range.to);
  }
  content(context: SelectionContext): SelectionContent {
    const fragments: SelectionFragment[] = this.ranges(context).map((range) => {
      const node = context.node(range.id);

      if (!node) throw new Error('Missing selected content');

      return range.kind === 'node'
        ? { kind: 'node', node }
        : {
            kind: 'text',
            node,
            from: range.from,
            to: range.to,
            text: (context.text(range.id) ?? '').slice(range.from, range.to),
          };
    });

    return { type: this.type, fragments };
  }
  abstract getBookmark(): SelectionBookmark;
  abstract encode(context: SelectionContext): SelectionJSON;
  abstract replace(context: SelectionContext, text: string): SelectionEdit;
  map(context: SelectionContext, mapping: SelectionMapping): Selection {
    return this.getBookmark().map(mapping).resolve(context);
  }
}
