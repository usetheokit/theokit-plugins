import { defineConfig } from 'tsup'

export default defineConfig({
  // One entry per `exports` subpath in package.json. These two lists must stay
  // in step: a subpath with no entry here resolves to a file the tarball does
  // not ship, which is exactly how #9 reached npm and stayed broken for weeks.
  // `pnpm e2e:consumer` asserts the correspondence on every CI run.
  entry: ['src/index.ts', 'src/stripe.ts', 'src/abacatepay.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  // tsup 8 strips the `node:` prefix by default (`removeNodeProtocol`), so
  // `node:crypto` ships as bare `crypto` — which Deno, Bun and Workers-style
  // runtimes do not resolve. Every package in this repo currently ships that
  // way; this one does not, because /abacatepay is a new entry point and there
  // is no reason to publish a known defect into it. The default flips in tsup 9.
  removeNodeProtocol: false,
  external: ['stripe', 'theokit', '@theokit/orm', 'drizzle-orm', 'reflect-metadata'],
})
