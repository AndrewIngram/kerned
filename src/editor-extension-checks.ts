import { z } from 'zod';

// This fixture uses only public API imports, with no demo nodes or built-in paragraph.
import {
  createSchema,
  defineNode,
  replaceAnnotations,
  sliceAnnotations,
  joinAnnotations,
  replaceInlineObjects,
  sliceInlineObjects,
  validateInlineObjects,
  inlinePlainText,
  type DocumentNode,
  type Schema,
  type RangeAnnotation,
  type InlineObject,
} from './model';
import { textSelection, createEditor, createAnchor, resolveAnchor } from './state';

const headingDefinition = defineNode({
  name: 'heading',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ value: z.string(), level: z.number().int().positive() }),
    content: { kind: 'text', field: 'value' },
  }),
});

const cardDefinition = defineNode({
  name: 'card',
  version: 1,
  options: {},
  schema: () => ({ attributes: z.strictObject({ url: z.string() }), content: { kind: 'atom' } }),
});

const definitions = [headingDefinition, cardDefinition] as const;

type Node = DocumentNode<typeof definitions>;

type Heading = Extract<Node, { kind: 'heading' }>;

function heading(node: Node): Heading {
  if (node.kind !== 'heading') throw new Error('Heading required');

  return node;
}

export function checkExtensions() {
  let assertions = 0;

  function check(ok: boolean, message: string) {
    assertions++;

    if (!ok) throw new Error(message);
  }

  function equal<Value>(a: Value, b: Value, message: string) {
    check(JSON.stringify(a) === JSON.stringify(b), message);
  }

  const schema = createSchema({ extensions: definitions });

  const original: Heading = {
    id: 1,
    key: 'title',
    kind: 'heading',
    level: 2,
    value: 'Independent schema',
  };

  const editor = createEditor(schema, [original], textSelection(1, 4, 4));
  const anchor = createAnchor(schema, editor.state, 'doc', 1, 8, 1);
  editor.dispatch({
    baseRevision: 0,
    origin: 'local',
    history: 'separate',
    time: 0,
    steps: [{ kind: 'split', id: 1, at: 4, rightId: 2, rightKey: 'second' }],
    selection: textSelection(2, 0, 0),
  });
  const resolved = resolveAnchor(schema, anchor, 'doc', editor.state, editor.journal);
  check(
    resolved.status === 'resolved' &&
      resolved.anchor.blockKey === 'second' &&
      resolved.anchor.offset === 4,
    'Custom schema anchor mapping',
  );
  editor.dispatch({
    baseRevision: 1,
    origin: 'local',
    history: 'separate',
    time: 1,
    steps: [{ kind: 'join', left: 1, right: 2 }],
  });
  equal(editor.state.nodes, [original], 'Custom heading join');
  editor.undo();
  check(editor.state.nodes.length === 2, 'Custom schema undo');
  editor.redo();
  equal(editor.state.nodes, [original], 'Custom schema redo');
  editor.dispatch({
    baseRevision: editor.state.revision,
    origin: 'local',
    history: 'separate',
    time: 2,
    steps: [{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'New ' }],
  });
  equal(
    heading(editor.state.nodes[0]).value,
    'New Independent schema',
    'Custom field text replacement',
  );

  for (const extensions of [
    [cardDefinition],
    [headingDefinition, headingDefinition],
    [
      headingDefinition,
      defineNode({
        name: 'dependent',
        version: 1,
        options: {},
        requires: ['missing'],
        schema: () => ({ attributes: z.strictObject({}), content: { kind: 'atom' } }),
      }),
    ],
  ]) {
    let rejected = false;

    try {
      const candidate = createSchema({ extensions });
      candidate.resolve(original);
    } catch {
      rejected = true;
    }

    check(rejected, 'Missing node, duplicate name or dependency rejected');
  }

  // Test the imperative transform contract independently of declarative definitions.
  const bad: Schema<Node> = {
    ...schema,
    editing: (node) => ({
      ...schema.editing(node),
      replace: (value) => ({ ...heading(value), value: 'wrong' }),
    }),
  };

  const broken = createEditor(bad, [original], textSelection(1, 0, 0));
  let rejected = false;

  try {
    broken.dispatch({
      baseRevision: 0,
      origin: 'local',
      history: 'separate',
      time: 0,
      steps: [{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'x' }],
    });
  } catch {
    rejected = true;
  }

  check(rejected && broken.state.revision === 0, 'Extension contract failure is atomic');

  // An unrelated annotation payload and inline token use exactly the comment/mention APIs.
  const range: RangeAnnotation<{ severity: number }> = {
    id: 'lint',
    start: 2,
    end: 8,
    data: { severity: 3 },
  };

  equal(
    joinAnnotations(
      sliceAnnotations([range], 0, 5),
      sliceAnnotations([range], 5, 10),
      5,
      (a, b) => a.severity === b.severity,
    ),
    [range],
    'Generic annotation split/join',
  );
  equal(
    replaceAnnotations([range], 0, 0, 3, { startBias: 1, endBias: -1, onOverlap: 'remove' })[0]
      .start,
    5,
    'Generic annotation mapping',
  );
  check(
    replaceAnnotations([range], 3, 4, 0, { startBias: 1, endBias: -1, onOverlap: 'remove' })
      .length === 0,
    'Annotation removal policy',
  );
  check(
    replaceAnnotations([range], 3, 4, 0, { startBias: 1, endBias: -1, onOverlap: 'map' })[0].end ===
      7,
    'Alternative annotation policy',
  );

  const token: InlineObject<{ formula: string }> = {
    id: 'equation',
    index: 1,
    data: { formula: 'a+b' },
  };

  validateInlineObjects('x\ufffcy', [token]);
  equal(
    inlinePlainText('x\ufffcy', [token], 0, 3, (d) => d.formula),
    'xa+by',
    'Custom inline clipboard text',
  );
  check(replaceInlineObjects([token], 0, 0, 2)[0].index === 3, 'Custom inline mapping');
  check(sliceInlineObjects([token], 1, 2)[0].index === 0, 'Custom inline slicing');

  return { assertions, checks: 'passed' };
}
