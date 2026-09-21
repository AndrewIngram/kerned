/** Static markup is structured data. Strings are text, never raw HTML. */
export type HtmlOutput =
  | string
  | Readonly<{
      tag: string;
      attributes?: Readonly<Record<string, string | number | boolean | undefined>>;
      children?: readonly HtmlOutput[];
    }>;

const voidTags = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function escape(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Escapes content without allocating a DOM or importing a browser parser.
 * Extension authors own tag/attribute semantics, including URL policy.
 */
export function renderHtml(output: readonly HtmlOutput[]): string {
  function render(value: HtmlOutput, depth: number): string {
    if (depth > 256) throw new Error('HTML output exceeds nesting limit');

    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- HtmlOutput is an already-typed text-or-element union; this discriminates its representations rather than validating external input.
    if (typeof value === 'string') return escape(value);
    const { tag, attributes = {}, children = [] } = value;

    if (!/^[a-z][a-z0-9-]*$/.test(tag)) throw new Error(`Invalid HTML tag: ${tag}`);

    const attrs = Object.entries(attributes)
      .map(([name, content]) => {
        if (!/^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/.test(name))
          throw new Error(`Invalid HTML attribute: ${name}`);

        if (content === undefined || content === false) return '';

        return content === true ? ` ${name}` : ` ${name}="${escape(String(content))}"`;
      })
      .join('');

    if (voidTags.has(tag)) {
      if (children.length) throw new Error(`Void HTML tag cannot contain children: ${tag}`);

      return `<${tag}${attrs}>`;
    }

    return `<${tag}${attrs}>${children.map((child) => render(child, depth + 1)).join('')}</${tag}>`;
  }

  return output.map((value) => render(value, 0)).join('');
}
