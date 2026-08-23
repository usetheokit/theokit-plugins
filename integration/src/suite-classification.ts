/**
 * Decides whether a test suite can run without a credential.
 *
 * The gate in `readiness.offline.test.ts` asks this to answer "may this suite run on every PR,
 * or does it belong to the nightly?". Getting the answer from the raw source text does not
 * work: this repository documents its own conventions inside the files that implement them, so
 * a suite that merely NAMES `required(...)` in a comment was read as credential-bound and
 * dropped out of the gate's scope entirely (#99). The gate then reported an empty list of
 * stranded suites, which reads exactly like coverage.
 *
 * So the question is answered structurally instead, from the TypeScript AST: does the file
 * CALL one of the credential-bound helpers? Comments, string literals and JSDoc are excluded by
 * construction rather than by another layer of pattern-matching.
 */

import ts from 'typescript'

/**
 * Helpers whose invocation means the suite cannot run unattended without a credential.
 *
 * `required` throws when the variable is absent; `describeLive` gates a whole suite on real
 * credentials and, when they are present, spends real money.
 */
const CREDENTIAL_BOUND_HELPERS: ReadonlySet<string> = new Set(['required', 'describeLive'])

/** Local bindings introduced by an import: direct aliases, plus namespaces to qualify through. */
interface Bindings {
  /** Local names that resolve to a credential-bound helper — `required`, or `required as need`. */
  readonly direct: Set<string>
  /** Local names bound to a whole module namespace — `import * as creds`. */
  readonly namespaces: Set<string>
}

function collectBindings(source: ts.SourceFile): Bindings {
  const direct = new Set<string>()
  const namespaces = new Set<string>()

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const clause = statement.importClause
    if (clause?.namedBindings === undefined) continue

    if (ts.isNamespaceImport(clause.namedBindings)) {
      namespaces.add(clause.namedBindings.name.text)
      continue
    }

    for (const element of clause.namedBindings.elements) {
      // `propertyName` is set only when the import is renamed: `{ required as need }`.
      const imported = element.propertyName?.text ?? element.name.text
      if (CREDENTIAL_BOUND_HELPERS.has(imported)) direct.add(element.name.text)
    }
  }

  return { direct, namespaces }
}

/** Whether this call expression invokes a credential-bound helper under the given bindings. */
function isCredentialBoundCall(call: ts.CallExpression, bindings: Bindings): boolean {
  const callee = call.expression

  if (ts.isIdentifier(callee)) return bindings.direct.has(callee.text)

  // `creds.required(...)` counts; `z.string().required()` does not — the object has to be a
  // namespace this file actually imported, or any object with a same-named method would match.
  if (ts.isPropertyAccessExpression(callee)) {
    return (
      CREDENTIAL_BOUND_HELPERS.has(callee.name.text) &&
      ts.isIdentifier(callee.expression) &&
      bindings.namespaces.has(callee.expression.text)
    )
  }

  return false
}

/** Every call to a credential-bound helper in `source`, in source order. */
function credentialBoundCalls(source: string, fileName: string): ts.CallExpression[] {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const bindings = collectBindings(parsed)
  if (bindings.direct.size === 0 && bindings.namespaces.size === 0) return []

  const calls: ts.CallExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isCredentialBoundCall(node, bindings)) calls.push(node)
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(parsed, visit)

  return calls
}

/**
 * Whether `source` calls a credential-bound helper, and therefore belongs to the nightly run.
 *
 * @param source - The TypeScript source of one test file.
 * @param fileName - Name reported to the parser; affects diagnostics only.
 */
export function callsCredentialBoundApi(source: string, fileName = 'suite.ts'): boolean {
  return credentialBoundCalls(source, fileName).length > 0
}

/**
 * The environment-variable names `source` reads through `required('NAME')`, deduplicated.
 *
 * Used to check that every variable a suite actually reads is declared in the service registry.
 * `GROQ_API_KEY` was read by the voice suite and declared nowhere: it lived in prose inside that
 * service's `caveat` and was hand-appended to the .env.example generator, so both CI gates —
 * which iterate the registry — were blind to it (#80).
 *
 * A non-literal argument is skipped rather than guessed at. `required(name)` cannot be resolved
 * without evaluating the file, and a gate that named a variable which does not exist would be
 * worse than one that stayed quiet about a case it cannot see.
 */
export function credentialNamesRead(source: string, fileName = 'suite.ts'): string[] {
  const names = new Set<string>()
  for (const call of credentialBoundCalls(source, fileName)) {
    const [first] = call.arguments
    if (first !== undefined && ts.isStringLiteralLike(first)) names.add(first.text)
  }
  return [...names]
}
