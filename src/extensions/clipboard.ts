import { createHtmlParser } from '../editor-browser';
import {
  createDocumentSerializer,
  createDocumentCodec,
  type NodeIdentity,
  type Schema,
} from '../model';
import { type EditorState } from '../state';
import { copyFragment, type ClipboardFragment } from './clipboard-fragment';
import { starterHtmlParsers } from './html-parsers';
import { paragraph, table } from './starter-definitions';
import { starterSerializers } from './static-serializers';
import { cellRectangleText } from './table-clipboard';

const mime = 'application/x-gprose-fragment';

// The token refers only to immutable fragments created in this page. Untrusted
// clipboard JSON never becomes editor state; other pages use the inert HTML importer.
const fragments = new Map<
  string,
  {
    read<N extends NodeIdentity>(schema: Schema<N>): ClipboardFragment<N>;
  }
>();

function remember<N extends NodeIdentity>(schema: Schema<N>, fragment: ClipboardFragment<N>) {
  const token = crypto.randomUUID();
  fragments.set(token, {
    read<T extends NodeIdentity>(target: Schema<T>): ClipboardFragment<T> {
      if (Object.is(target, schema)) {
        const canonical: ClipboardFragment<NodeIdentity> = fragment;

        // SAFETY: Schema object identity proves that these canonical nodes belong to
        // the target schema. No externally supplied value enters this local store.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Restore the node type after checking the exact schema owner; retaining immutable node identity avoids a serialization boundary.
        return canonical as ClipboardFragment<T>;
      }

      return {
        inline: fragment.inline,
        nodes: createDocumentCodec(target).decode(
          createDocumentCodec(schema).encode(fragment.nodes),
        ),
      };
    },
  });

  if (fragments.size > 8) {
    const first = fragments.keys().next().value;

    if (first) fragments.delete(first);
  }

  return token;
}

export function writeClipboard<N extends NodeIdentity>(
  data: DataTransfer,
  schema: Schema<N>,
  state: EditorState<N>,
  text: string,
  serializer = createDocumentSerializer(schema, starterSerializers, { unsupported: 'text' }),
) {
  const fragment = copyFragment(schema, state);
  const html = serializer.serialize(fragment.nodes).html;
  const rectangle = fragment.nodes.length === 1 && schema.isNode(fragment.nodes[0], table);
  const plain = rectangle ? cellRectangleText(schema, fragment.nodes[0]) : text;
  const token = remember(schema, fragment);

  data.setData('text/plain', plain);
  data.setData('text/html', html);
  data.setData(mime, token);
}

export function readClipboard<N extends NodeIdentity>(
  data: DataTransfer,
  schema: Schema<N>,
  parser?: ReturnType<typeof createHtmlParser<N>>,
): ClipboardFragment<N> | null {
  const local = fragments.get(data.getData(mime));

  if (local) return local.read(schema);
  const source = data.getData('text/html');

  if (!source) return null;
  const nodes = (parser ?? createHtmlParser(schema, starterHtmlParsers)).parse(source);

  if (!nodes.length) return null;

  return {
    nodes,
    inline: nodes.length === 1 && schema.isNode(nodes[0], paragraph),
  };
}
