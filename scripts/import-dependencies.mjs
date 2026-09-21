import assert from 'node:assert/strict';

import ts from 'typescript';

// Traverse syntax, not just top-level import declarations: a barrel or lazy
// import must not provide a back door through the same ownership boundary.
export function dependencies(file, code) {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const result = [];

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      result.push(node.moduleSpecifier.text);

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      assert.ok(
        argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)),
        `${file}: dynamic import must have a statically checkable target`,
      );
      result.push(argument.text);
    }

    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      result.push(node.argument.literal.text);

    ts.forEachChild(node, visit);
  }

  visit(source);

  return result;
}
