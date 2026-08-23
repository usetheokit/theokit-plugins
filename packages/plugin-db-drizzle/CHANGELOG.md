# @theokit/plugin-db-drizzle

## 0.4.0

### Minor Changes

- f71f9bc: The `theokit` peer floor is `>=0.48.7`, the version these packages are actually built against.

  The declared floors ranged from `>=0.1.0-alpha.5` to `>=0.4.0-beta.0` while every one of these
  packages carries `theokit: ^0.48.7` as its devDependency. Those ranges span the framework's move
  from `defineRoute({...})`-style functions to builders, so they admitted versions the code does not
  compile against — and the failure would land in a consumer's build, pointing at our package.

  Two of the old floors were pre-release versions, which promised compatibility with a version the
  framework itself did not consider stable.

  Widening a floor again is welcome, and now has a price: a CI job that builds the package against
  the version being claimed. `check:manifests` fails when a peer floor drops below the
  devDependency the package is built with.

### Patch Changes

- 46b22c8: Seven `@theokit/*` peer dependencies that no package imported are removed.

  Each appeared in the source only inside comments — several of them in comments explaining the
  structural shape chosen precisely to AVOID depending on the package, and one in
  `plugin-payments` stating outright that "plugin doesn't take a peerDep on a specific
  @theokit/orm version". A peer nobody imports is not inert: it drags its own dependency tree into
  the consumer's resolution, which is how `@theokit/plugin-forms` became impossible to install
  with npm (#64).

  Removed: `@theokit/sdk` from plugin-canvas and plugin-realtime, `@theokit/orm` from
  plugin-db-drizzle and plugin-payments, and `@theokit/plugin-canvas`, `@theokit/plugin-voice` and
  `@theokit/ui` from plugin-copilot. Nothing imported them, so no consumer code changes.

## 0.3.1

### Patch Changes

- bfa7409: The README examples now use the API `theokit@0.48` exports, and every one of them was verified by compiling it rather than by reading it. Ten names they told you to import — `defineConfig`, `defineRoute`, `definePlugin`, `defineAction`, `defineAgentTool`, `defineTheoConfig`, `defineAgentEndpoint`, `streamAgentRun`, `createConversationHistory`, `useAgentStream` — exist in none of that version's 24 export subpaths. Copying the first block of most of these READMEs produced code that did not compile.

  The `auth-google` and `auth-magic-link` wiring examples changed shape rather than names: the auth orchestrator takes Node's `IncomingMessage`/`ServerResponse`, and no handler surface TheoKit exposes today hands you those, so the examples show a Node server and state the gap.

## 0.3.0

### Minor Changes

- 458dc9a: Os verbos do CLI passaram a emitir argumentos que o `drizzle-kit` real aceita (#48).

  Cinco dos seis verbos de passthrough montavam uma linha de comando recusada pelo binário — só
  `db push` funcionava. `generate` omitia o `--dialect` que o drizzle-kit exige, `migrate` e
  `studio` recebiam flags que eles rejeitam (aceitam apenas `--config`), `check` recebia
  `--schema`/`--url` e não recebia `--out`, e `reset` invocava um subcomando que não existe.

  Junto, `db studio` passou a abrir (#49): o peer `drizzle-orm` subiu para `>=0.37.0`, a primeira
  versão que exporta `./singlestore-core` — subpath que o drizzle-kit importa e sem o qual o studio
  morre ao ler o config.

  BREAKING para quem chama `buildDbCommands()` direto: a forma dos argumentos mudou por verbo,
  `DbCommand.kind` ganhou `'drizzle-kit-with-config'` (o executor precisa escrever
  `renderDrizzleConfig(opts)` em `opts.configPath` antes do spawn), e `reset` virou
  `'user-script'` com a nova opção `resetScript`. E o piso do peer `drizzle-orm` subiu de `>=0.36.0`
  para `>=0.37.0`.

## 0.2.0

### Minor Changes

- c351485: The plugins are TheoKit adapters now, and two of them stop typing against an API that does not exist (#42).

  Measured across the eleven packages: **none** used the framework's plugin authoring API, and two declared a local `TheoPluginApp` describing methods `TheoApp` does not have — `registerRoute`/`hasRoute` in payments, `registerModule`/`registerCliCommand`/`registerDevtoolsTab`/`hasCliCommand` in db-drizzle. Both type-checked, because TypeScript is structural and the parameter was never used. The real contract is `{ addHook, decorateRequest }`, and `import type` is erased at build — so importing the real one costs nothing at runtime, which `plugin-voice` had been documenting two directories away.

  **`@theokit/plugin-payments`** — `register()` publishes the gateways on `ctx.payments`, the `@InjectStripeClient` equivalent:

  ```ts
  const result = await ctx.payments.handleWebhook(params.gateway, { rawBody, headers, url })
  ```

  That surface is deliberately narrower than the plugin — `providers`, `provider(key)`, `handleWebhook`, and **not** `store` or `registry`. The narrowing buys a safety property rather than tidiness: a handler holding `store` can claim or release an event id outside the dispatcher and defeat idempotency; one holding `registry` can rewire routing mid-request.

  `stripePayments()` publishes the client on `ctx.stripe` and resolves it **at boot**, so a missing `STRIPE_SECRET_KEY` crashes on startup instead of 500-ing while somebody is paying.

  **`@theokit/plugin-db-drizzle`** — `register()` used to call the invented methods behind `if (app.registerCliCommand)` guards, so seven documented CLI verbs and a devtools tab were a silent no-op for several releases (#43). The dead branches are gone and `register()` is now empty _by decision_, with the reason stated: this plugin has no runtime surface to publish.

  `buildDbCommands` and `buildDevtoolsTab` are **exported** — they were reachable only from a `register()` calling a nonexistent API and from their own ~30 assertions, so exporting them un-hides surface that already existed and was already tested. The README no longer promises `theokit db <verb>`, which the `theokit` CLI (build / dev / doctor / start) has never had; it shows the script you wire yourself, and that example was executed before shipping.

  **BREAKING** in both: `TheoPluginApp` is gone. `register(app)` now takes the framework's `TheoApp`. Anything calling it with a hand-rolled object needs `{ addHook, decorateRequest }` — which is what the plugin runner has always passed.

## 0.1.2

### Patch Changes

- 2c0b594: Internal quality: bring every package to `pnpm lint --max-warnings=0` + `prettier`
  compliance (437 pre-existing ESLint errors + workspace formatting). All fixes are
  behavior-preserving — `require-await` resolved by returning `Promise.resolve(...)`
  where a Promise contract is required, `no-unsafe-*` resolved with precise types
  (no `any`), `unbound-method` via property-signatures / arrow wrappers. No public API
  or runtime behavior changes; 665/665 tests remain green.

## 0.1.1

### Patch Changes

- e91aefe: Make the CLI `db`-namespace conflict guard effective (#171). Previously both branches of the `hasCliCommand("db")` check called `registerCliCommand` identically (a no-op guard). Now the conflict path warns the operator that it is extending an already-registered `db` namespace (e.g. one owned by `@theokit/orm`) before merging the drizzle verbs, so a silent namespace collision is observable. No public API change.
- 2c2b237: Harden the studio devtools iframe and make its URL configurable (#206, #207). The iframe `sandbox` no longer combines `allow-scripts` with `allow-same-origin` (that pairing lets the framed page remove its own sandbox and escape) — it is now `allow-scripts` only, which is safe because studio runs on its own origin (#206). The `studioUrl` is now built from new `studioHost`/`studioPort` options (default `localhost:4983`) instead of a hardcoded constant, so a custom studio host/port is honored (#207). Both options are additive.
- fb9ab0c: Forward the configured connection options to drizzle-kit (#169). For the verbs that open a database connection (`migrate`, `push`, `studio`, `check`), `buildDbCommands` now emits `--dialect <postgresql|mysql|sqlite>` (mapped from the configured `driver` — drizzle-kit's flag is `--dialect`, not `--driver`) and `--url <url>`. Previously these documented options were accepted but never reached the CLI invocation. `generate` (schema-diff only) does not receive them, and each flag is omitted when its source option is undefined (no corrupt arg vector).
- 30efd06: Add the documented destructive-op guard for `db reset` (#168). The `reset` command descriptor now carries `requiresForce: true`, so the CLI runner refuses to execute it unless the user passes `--force`. The `DbCommand` interface gains an optional `requiresForce` field (additive). Note: the descriptor declares the requirement; the actual refusal is enforced by the CLI runner (which has the user's argv) — the pure `buildDbCommands` factory has no access to invocation flags.
- 1ba8408: `db seed` now runs the user's seed script instead of a nonexistent `drizzle-kit seed` subcommand (#170). `DbCommand` gains a `kind: "drizzle-kit" | "user-script"` discriminant; `seed` is `kind: "user-script"` and its `buildArgs` returns the configured `seedScript` path (the runner executes it as a script). A new optional `seedScript` option (settable on `drizzleDb(...)` or resolved at register-time from `package.json#theokit.db.seed`) supplies the path; when none is configured, `db seed` throws a clear error rather than spawning a subcommand that does not exist. Additive — every other verb stays `kind: "drizzle-kit"`.

## [Unreleased]

## [0.1.0] - 2026-06-04 (initial publish on `@next`)

Per plan [`p5-plugin-db-drizzle-plan.md`](../../../.claude/knowledge-base/plans/p5-plugin-db-drizzle-plan.md) v1.0 and blueprint [`p5-plugin-db-drizzle-blueprint.md`](../../../.claude/knowledge-base/discoveries/blueprints/p5-plugin-db-drizzle-blueprint.md) v1.0 (SHIPPABLE 98.8/100). Form 4 Hybrid — plugin wraps `@theokit/orm` behind a TheoKit plugin-shape factory.

### Added

- **`drizzleDb(opts: DrizzleDbOptions): DrizzleDbPlugin`** factory. Pass to `theo.config.ts > plugins: [...]`. The returned plugin carries `kind: 'db'`, resolved options, and a `register(app)` lifecycle hook.
- **Seven canonical CLI verbs** under the `db` namespace: `generate / migrate / push / studio / reset / seed / check`. Each verb shells out to `drizzle-kit` via Node `child_process.spawn` with config wired from plugin options. Blueprint ADR D3 — wasp's 7-verb sweet spot (extension over orm's existing 6).
- **`DrizzleDriver`** canonical driver name union (`'sqlite' | 'postgres' | 'mysql'`).
- **`DrizzleDbOptions`** + **`ResolvedDrizzleDbOptions`** typed option shapes. Sensible defaults: `schemaPath='./db/schema.ts'`, `migrationsPath='./db/migrations'`, `devtoolsTab=true`.
- **`buildDevtoolsTab(opts)`** descriptor exported for tests + consumers. The tab's `mount(container)` builds an IFRAME pointing at `http://localhost:4983` (drizzle-kit's default studio port). Blueprint ADR D2 — passthrough is canonical.
- **`TheoPluginApp`** structural type — minimal surface the plugin's `register()` needs. Lets the plugin run against any app object that quacks like the TheoKit plugin runner.

### Notes

- **Studio is passthrough.** No custom UI panel ships in v0.1. Blueprint ADR D2 (2/2 references converge — wasp `runStudio`, rails `dbconsole`).
- **`@theokit/orm` is a required peer.** This plugin wraps orm; it does not duplicate. Existing orm consumers (Repository / `@InjectRepository` / `@Transactional` / `OrmModule`) keep working unchanged. Migration guide in README.
- **`drizzle-kit` is an optional peer.** Runtime apps that never invoke CLI don't need it installed.
- **CLI EC-4 conflict guard.** If `@theokit/orm`'s CLI already registered the `db` namespace, the plugin extends it instead of replacing (preserves orm's 6 verbs + adds `seed`).
- **Devtools-tab is opt-in and dev-only.** When the TheoKit devtools overlay (G4) is loaded, the tab IFRAMEs drizzle-kit studio. Pass `devtoolsTab: false` to suppress. Production builds tree-shake the tab module.

### Quality gates

- 25 unit + integration tests GREEN (factory shape × 8, register lifecycle × 5, CLI verbs × 5, devtools tab × 4, lifecycle smoke × 3).
- `npx tsc --noEmit`: exit 0.
- `npx tsup src/index.ts --format esm --dts --clean`: dist `2.51 KB` JS + `4.14 KB` d.ts.
- Zero new npm packages introduced — plugin is a thin wrapper over existing orm + theokit + drizzle-orm peers.

### Quality gates (deferred to dogfood-app cohort)

- **dogfood-app smoke test** — wiring `drizzleDb({driver: 'sqlite'})` into `dogfood-app/theo.config.ts` + asserting `/api/memory` round-trip. Gated on @theokit/orm@0.1.0-next.1 + theokit@0.4.0 promote alignment ~2026-07-15.
- **Real drizzle-kit child_process spawn validation** — Phase 3 T3.2 dogfood requirement.
