# Contributing to theokit-plugins

This repo is the **first-party plugin monorepo** for [TheoKit](https://github.com/usetheokit/theokit). It is intentionally empty until the first plugin clears the gates below (per [ADR-0008](https://github.com/usetheokit/theokit/blob/main/docs/adr/0008-theoplugin-is-the-canonical-sdk.md) + CLAUDE.md macro-roadmap R0.6.5).

## Two contribution paths

### A — Propose a new first-party plugin

Open a **discussion** (not a PR) at [usetheodev/theokit/discussions](https://github.com/usetheokit/theokit/discussions) titled `[plugin proposal] <name>`. Include:

1. **Problem** — what need does this solve? Why isn't a TheoKit core primitive enough?
2. **Production evidence** — at least 1 app using a draft version (your own community package is fine)
3. **Demand signal** — link to 3+ issues / discussions / Slack threads requesting this
4. **Scope** — estimated LOC, dependencies, maintenance burden
5. **API sketch** — `definePlugin({...})` call signature + options interface

If accepted, a maintainer creates the package skeleton in `packages/plugin-<name>/`.

### B — Improve an existing first-party plugin

PRs welcome. Process:

1. Fork + clone
2. `pnpm install`
3. `pnpm changeset` (describe the user-facing change)
4. Make your change in `packages/plugin-<name>/`
5. `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
6. Push + PR against `main`

CI runs all gates. Changesets bot opens a release PR; merging that publishes.

## First-party gates (re-stated from README)

A plugin earns its place in `@theokit/plugin-*` only when ALL hold:

| Gate                                    | Verification                                                       |
| --------------------------------------- | ------------------------------------------------------------------ |
| 1+ app in production                    | Public link or attestation in proposal                             |
| 3+ requests                             | Issue/discussion links                                             |
| Not duplicating core                    | Reviewer check against `packages/theo/src/server/index.ts` exports |
| Maintainable (<100 LOC OR <1 week/year) | Reviewer estimation                                                |
| Tests + fixture                         | Required in the package PR                                         |

Plugins not meeting all five live in community space (`@<your-scope>/theokit-plugin-<name>`).

## Package layout (when populated)

```
packages/plugin-<name>/
├── src/
│   └── index.ts              # default export: factory returning TheoPlugin
├── tests/
│   ├── unit/<name>.test.ts   # unit tests (vitest)
│   └── fixtures/             # mini fixture proving end-to-end
├── package.json              # name: "@theokit/plugin-<name>", peer-dep theokit
├── tsconfig.json             # extends ../../tsconfig.base.json
├── tsup.config.ts            # build to dist/
├── README.md                 # usage example + options reference
└── CHANGELOG.md              # auto-managed by changesets
```

## Package boilerplate

Minimum `package.json`:

```json
{
  "name": "@theokit/plugin-<name>",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "test": "vitest run"
  },
  "peerDependencies": {
    "theokit": ">=0.5.0"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

Minimum `src/index.ts`:

```ts
import { plugin, type TheoPlugin } from 'theokit/server'

export interface MyPluginOptions {
  // user-facing options
}

export default function myPlugin(options: MyPluginOptions = {}): TheoPlugin {
  // `plugin(name)` synthesises `register(app)` from the hooks and decorations you
  // chain — you never write the imperative body.
  return plugin('@theokit/plugin-<name>').decorateRequest('myPlugin', options).build()
}
```

## Code style

Same as TheoKit core: ESLint + Prettier + TypeScript strict. Run `pnpm format` before committing.

## License

By contributing you agree your contribution is MIT-licensed.

## Questions

Open a discussion at [usetheodev/theokit](https://github.com/usetheokit/theokit/discussions). For TheoKit framework bugs (not plugin bugs), use [usetheodev/theokit/issues](https://github.com/usetheokit/theokit/issues).
