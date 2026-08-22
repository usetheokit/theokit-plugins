/**
 * Extracts the module specifiers a JavaScript file imports.
 *
 * The packaging contract asks whether a published artifact imports a Node builtin without the
 * `node:` prefix (#38: tsup 8 strips it by default, and Deno, Bun and Workers-style runtimes do
 * not resolve the bare name). Answering that means knowing what the file imports.
 *
 * A regex cannot know. The previous one — /(?:from|import)\s*\(?\s*["']([^"']+)["']/g — matched
 * `Buffer.from('crypto')`: `from` matches, `\(?` eats the paren, and the argument is read as a
 * specifier. Both `crypto` and `os` are builtin names, so ordinary code containing
 * `Buffer.from('crypto')` or `Array.from('os')` reported a packaging BLOCKER that was not there,
 * on every pull request (#84). Comments and string literals matched just as happily.
 *
 * Reading them from the AST removes the whole class rather than the two examples of it.
 */

import ts from 'typescript'

/**
 * Every module specifier `source` imports, in source order, duplicates included.
 *
 * Covers the three forms ESM output uses: static `import`, re-export `from`, and dynamic
 * `import()`. A dynamic import whose argument is not a string literal is skipped — it cannot be
 * resolved without running the module, and naming a guess would report a dependency the file
 * does not have.
 *
 * @param source - JavaScript (or TypeScript) source text.
 * @param fileName - Name reported to the parser; affects diagnostics only.
 */
export function moduleSpecifiers(source: string, fileName = 'module.js'): string[] {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found: string[] = []

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text)
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [first] = node.arguments
      if (first !== undefined && ts.isStringLiteralLike(first)) found.push(first.text)
    }

    ts.forEachChild(node, visit)
  }
  ts.forEachChild(parsed, visit)

  return found
}
