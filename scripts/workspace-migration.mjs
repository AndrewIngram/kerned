import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

// The source-to-package moves are explicit so reviewers can audit ownership.
// Rerunning after a move verifies the destination rather than recreating old paths.
export const packageMoves = [
  ...['model', 'transform', 'state', 'core'].map((name) => ({
    from: `src/${name}`,
    to: `packages/${name}/src`,
    name: `@gprose/${name}`,
  })),
  { from: 'src/editor-browser', to: 'packages/view/src/browser', name: '@gprose/view' },
  { from: 'src/editor-canvas', to: 'packages/view/src/canvas', name: '@gprose/view' },
  { from: 'src/editor-react', to: 'packages/react/src', name: '@gprose/react' },
  ...[
    'engines.ts',
    'layout-types.ts',
    'owned-blocks.ts',
    'owned-carets.ts',
    'owned-document.ts',
    'owned-inline.ts',
    'owned-layout.ts',
    'owned-packed.ts',
    'owned-paragraph.ts',
    'owned-shaped.ts',
    'owned-text-support.ts',
    'owned-inline-checks.ts',
  ].map((file) => ({
    from: `src/${file}`,
    to: `packages/view/src/internal/${file}`,
    name: '@gprose/view',
  })),
  { from: 'src/__tests__', to: 'packages/view/src/internal/__tests__', name: '@gprose/view' },
  {
    from: 'src/extensions/comment.ts',
    to: 'packages/extension-comments/src/comment.ts',
    name: '@gprose/extension-comments',
    public: '@gprose/extension-comments',
  },
  {
    from: 'src/extensions/comment-projection.ts',
    to: 'packages/extension-comments/src/projection.ts',
    name: '@gprose/extension-comments',
    public: '@gprose/extension-comments',
  },
  {
    from: 'src/extensions/comment-view.ts',
    to: 'packages/extension-comments/src/browser.ts',
    name: '@gprose/extension-comments',
    public: '@gprose/extension-comments/browser',
  },
  {
    from: 'src/extensions/__tests__/comment-view.browser.test.ts',
    to: 'packages/extension-comments/src/__tests__/comment-view.browser.test.ts',
    name: '@gprose/extension-comments',
  },
  {
    from: 'src/extensions/history.ts',
    to: 'packages/extension-history/src/index.ts',
    name: '@gprose/extension-history',
    public: '@gprose/extension-history',
  },
  {
    from: 'src/extensions/outline.ts',
    to: 'packages/extension-outline/src/index.ts',
    name: '@gprose/extension-outline',
    public: '@gprose/extension-outline',
  },
  {
    from: 'src/extensions/search-view.ts',
    to: 'packages/extension-search/src/index.ts',
    name: '@gprose/extension-search',
    public: '@gprose/extension-search',
  },
  {
    from: 'src/extensions/search-view.css',
    to: 'packages/extension-search/src/search-view.css',
    name: '@gprose/extension-search',
  },
  {
    from: 'src/extensions/__tests__/search-view.browser.test.ts',
    to: 'packages/extension-search/src/__tests__/search-view.browser.test.ts',
    name: '@gprose/extension-search',
  },
  { from: 'src/extensions/outline-view.tsx', to: 'src/demo/outline-menu.tsx' },
  { from: 'src/extensions/outline.css', to: 'src/demo/outline.css' },
  { from: 'src/extensions/html.ts', to: 'src/demo/import-html.ts' },
  {
    from: 'src/extensions/formatting.ts',
    to: 'packages/extension-document/src/formatting.ts',
    name: '@gprose/extension-document',
    public: '@gprose/extension-document',
  },
  {
    from: 'src/extensions/mention.ts',
    to: 'packages/extension-document/src/mention.ts',
    name: '@gprose/extension-document',
    public: '@gprose/extension-document',
  },
  {
    from: 'src/extensions/text-commands.ts',
    to: 'packages/extension-document/src/text-commands.ts',
    name: '@gprose/extension-document',
    public: '@gprose/extension-document',
  },
  {
    from: 'src/extensions/starter-kit/formatting.ts',
    to: 'packages/extension-document/src/commands.ts',
    name: '@gprose/extension-document',
    public: '@gprose/extension-document',
  },
  {
    from: 'src/extensions/cell-selection.ts',
    to: 'packages/extension-table/src/selection.ts',
    name: '@gprose/extension-table',
    public: '@gprose/extension-table',
  },
  {
    from: 'src/extensions/table.ts',
    to: 'packages/extension-table/src/table.ts',
    name: '@gprose/extension-table',
    public: '@gprose/extension-table',
  },
  {
    from: 'src/extensions/table-clipboard.ts',
    to: 'packages/extension-table/src/clipboard.ts',
    name: '@gprose/extension-table',
    public: '@gprose/extension-table',
  },
  {
    from: 'src/extensions/starter-kit/tables.ts',
    to: 'packages/extension-table/src/commands.ts',
    name: '@gprose/extension-table',
    public: '@gprose/extension-table',
  },
  {
    from: 'src/extensions/starter-kit/table-node-view.ts',
    to: 'packages/extension-table/src/browser.ts',
    name: '@gprose/extension-table',
    public: '@gprose/extension-table/browser',
  },
  {
    from: 'src/extensions/starter-kit/table-view.ts',
    to: 'packages/extension-table/src/table-view.ts',
    name: '@gprose/extension-table',
  },
  {
    from: 'src/extensions/starter-kit/table-content.ts',
    to: 'packages/extension-table/src/table-content.ts',
    name: '@gprose/extension-table',
  },
  {
    from: 'src/extensions/starter-kit/table-view.css',
    to: 'packages/extension-table/src/table-view.css',
    name: '@gprose/extension-table',
  },
  {
    from: 'src/extensions/starter-kit/__tests__/table-view.browser.test.ts',
    to: 'packages/extension-table/src/__tests__/table-view.browser.test.ts',
    name: '@gprose/extension-table',
  },
  {
    from: 'src/extensions/starter-kit/__tests__/mounted-table.browser.test.ts',
    to: 'packages/extension-table/src/__tests__/mounted-table.browser.test.ts',
    name: '@gprose/extension-table',
  },
  {
    from: 'src/extensions/__tests__/scoped-cell-selection.test.ts',
    to: 'packages/extension-table/src/__tests__/scoped-cell-selection.test.ts',
    name: '@gprose/extension-table',
  },
];

const apply = process.argv.includes('--apply');

const active = packageMoves.filter((move) => existsSync(move.from));

for (const move of packageMoves)
  assert.ok(
    existsSync(move.from) || existsSync(move.to),
    `Missing source and destination: ${move.from}`,
  );

const files = ['src', 'packages', 'tests', 'scripts'].flatMap((root) =>
  existsSync(root)
    ? readdirSync(root, { recursive: true })
        .filter(
          (name) =>
            /\.(?:ts|tsx|js|mjs|css)$/.test(name) && !/(?:^|\/)(?:dist|node_modules)\//.test(name),
        )
        .map((name) => `${root}/${name}`)
    : [],
);

function moved(file) {
  const move = active.find((entry) => file === entry.from || file.startsWith(`${entry.from}/`));

  return move ? move.to + file.slice(move.from.length) : file;
}

function resolve(file) {
  return [
    file,
    file.replace(/\.js$/, '.ts'),
    file.replace(/\.js$/, '.tsx'),
    `${file}.ts`,
    `${file}.tsx`,
    `${file}.js`,
    `${file}/index.ts`,
    `${file}/index.tsx`,
  ].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function specifier(file, value, moduleImport) {
  const absolute = /^\/(?:src|packages)\//.test(value);

  if (!absolute && (!moduleImport || !value.startsWith('.'))) return value;

  const target = resolve(
    absolute ? value.slice(1) : path.normalize(path.join(path.dirname(file), value)),
  );

  if (!target) return value;

  const destination = moved(target),
    current = moved(file);

  const owner = packageMoves.find(
    (entry) => destination === entry.to || destination.startsWith(`${entry.to}/`),
  );

  const sameOwner = owner && current.startsWith(owner.to.split('/src')[0] + '/src/');

  if (owner?.public && !sameOwner) return absolute ? `/@id/${owner.public}` : owner.public;

  if (
    owner?.name &&
    !sameOwner &&
    /\/index\.tsx?$/.test(destination) &&
    (destination === `${owner.to}/index.ts` || destination === `${owner.to}/index.tsx`)
  )
    return absolute ? `/@id/${owner.name}` : owner.name;

  if (absolute) return destination === target ? value : `/${destination}`;

  if (destination === target && current === file) return value;
  let relative = path.relative(path.dirname(current), destination);

  if (!relative.startsWith('.')) relative = `./${relative}`;

  return relative.replace(/\.tsx?$/, '.js');
}

const edits = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const replacements = [];

  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;

      const moduleImport =
        ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
          parent.moduleSpecifier === node) ||
        (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) ||
        (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent));

      const next = specifier(file, node.text, moduleImport);

      if (next !== node.text)
        replacements.push({
          start: node.getStart(parsed),
          end: node.getEnd(),
          value: JSON.stringify(next),
        });
    }

    ts.forEachChild(node, visit);
  }

  visit(parsed);
  let result = source;

  for (const edit of replacements.toReversed())
    result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);

  if (result !== source || moved(file) !== file)
    edits.push({ file, destination: moved(file), source: result });
}

console.log(JSON.stringify({ moves: active, editedFiles: edits.length, apply }, null, 2));

if (apply) {
  for (const move of active) {
    assert.ok(!existsSync(move.to), `Destination already exists: ${move.to}`);
    mkdirSync(path.dirname(move.to), { recursive: true });
    renameSync(move.from, move.to);
  }

  for (const edit of edits) writeFileSync(edit.destination, edit.source);
}
