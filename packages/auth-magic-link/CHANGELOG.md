# Changelog

## 0.4.1

### Patch Changes

- 2b5779a: Widen the `@theokit/sdk` peer range from `^2.18.0` to `>=2.18.0`. These packages work with the current sdk major and the old range said otherwise.

  If you use `create-theokit`, your app pins `@theokit/sdk@^4`. Installing these packages alongside it produced a peer mismatch that **pnpm did not warn about** — you got a combination nobody had declared support for and were not told.

  What the widening rests on, measured against `@theokit/sdk@4.53.1` rather than assumed:
  - the three auth packages import **types only** (`AuthProvider`, `AuthResult`, `OAuthTransaction`), erased at compile time. No sdk code runs in them; the helpers they execute come from `theokit/server/auth`.
  - `plugin-copilot` is the one with a real runtime dependency, and each function it calls was exercised: `Budget.create`, `Budget.get`, `remainingIn`, `preflightCheck`, `chargeAndCheckThresholds`, `computeCost`.

  Unrelated to this change and worth knowing if you use the sdk's auth orchestrator: `Auth.create(...)` cannot complete an OAuth sign-in on any published sdk version — the transaction cookie is written under one name and read under another. Reported as usetheokit/theokit-sdk#376. Composing providers through `route()` is unaffected and works.

## 0.4.0

### Minor Changes

- 8da6ba8: `startSignIn` accepts the body a framework already parsed, so the provider composes with a TheoKit
  route.

  TheoKit hands a route handler a `Request` built without a body and delivers the parsed value
  separately as `ctx.body`. `startSignIn(request)` could therefore never reach the address inside a
  route: it threw `invalid_email` while the email sat in `ctx.body`. #68 made the type accept a
  `Request`; this makes the runtime work.

  The new parameter is optional and the resolution order is unchanged — `?email=` still wins, and a
  caller that reads the body from the stream is unaffected. Inside a route, pass it through:
  `startSignIn(request, body)`.

- f6de463: Framework peer ranges describe the version each package is built against.

  `@theokit/sdk` was declared `>=2.18.0` — unbounded — on the four packages that import it, while
  the published SDK is 4.53.1 and their devDependency pins `^2.18.0`. A consumer on the current SDK
  satisfied the peer, installed without a warning, and received code compiled two majors earlier.
  Narrowed to `^2.18.0`.

  `plugin-canvas` declared `@theokit/ui: ^1.1.0` while building against `^1.3.2`; narrowed to
  `^1.3.2`. No live break there — `DiffViewer` is exported from 1.1.0 — but the range promised
  versions nothing compiles against.

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

## 0.3.0

### Minor Changes

- 7adfdf7: These providers now accept a Web `Request` wherever they accepted Node's `IncomingMessage`, which is what makes them usable inside a TheoKit app at all.

  The SDK's `AuthProvider` interface types the callback parameter as `IncomingMessage`, and TheoKit's `route()` handler hands a Web `Request` — the runtime converts before dispatch, so the Node objects never reach a handler. Wiring any of these into a TheoKit route did not compile, and nothing in the test suites covered that composition. `handleCallback` (all three) and `startSignIn` / the `resolveEmail` option (magic-link) now take `IncomingMessage | Request`, so the whole flow can stay on the Web shapes TheoKit gives you: drive the provider directly and create the session with `createSessionManagerWeb` from `theokit/server/auth`.

  `@theokit/auth-magic-link` reads the request body, and the Web path reads it in capped chunks rather than through `Request.text()` — the 16 KB DoS cap that has always guarded the Node path now guards this one too.

  The `defineAuth` orchestrator is unchanged and still Node-shaped; it is the other way in, for apps running their own Node server.

### Patch Changes

- 03b1b5d: Every published export now carries documentation an editor can show. Previously 63.4% of them did (230 of 363), and two packages showed nothing at all: `@theokit/auth-github` and `@theokit/auth-google` measured 0/4, because their module headers began with `@theokit/...`, which TypeScript parses as a tag name and swallows the whole block — text was written and no reader ever got it.

  Seven docblocks were also stranded above another docblock, so they attached to nothing: the symbol they described shipped undocumented and the text shipped invisible. `defineCopilot`'s documentation, including its full usage example, was one of them.

  Type shapes are unchanged. This is visible to consumers because documentation ships in the `.d.ts`.

- bfa7409: The README examples now use the API `theokit@0.48` exports, and every one of them was verified by compiling it rather than by reading it. Ten names they told you to import — `defineConfig`, `defineRoute`, `definePlugin`, `defineAction`, `defineAgentTool`, `defineTheoConfig`, `defineAgentEndpoint`, `streamAgentRun`, `createConversationHistory`, `useAgentStream` — exist in none of that version's 24 export subpaths. Copying the first block of most of these READMEs produced code that did not compile.

  The `auth-google` and `auth-magic-link` wiring examples changed shape rather than names: the auth orchestrator takes Node's `IncomingMessage`/`ServerResponse`, and no handler surface TheoKit exposes today hands you those, so the examples show a Node server and state the gap.

## 0.2.3

### Patch Changes

- 82a154a: O `createOrmStore` passou a ser testado contra um banco real, incluindo a exigência de atomicidade
  que a interface declarava em prosa e ninguém verificava.

  `MagicLinkRepository.consumeAtomically` exige "a single SQL UPDATE...RETURNING … so concurrent
  callers race on the row lock". A suíte anterior cobria o store por um repositório em memória, que é
  atômico por construção — JavaScript é single-threaded, então um fake não falha do jeito que SQL
  falha.

  O novo teste implementa o repositório **duas vezes** contra o mesmo SQLite real: um com
  `UPDATE … WHERE consumedAt IS NULL RETURNING`, outro com SELECT-depois-UPDATE. O primeiro sobrevive a
  duas consumações concorrentes; o segundo perde o uso único — e um token de magic-link consumível duas
  vezes é bypass de autenticação. Os dois casos provam um ao outro.

  Também afirma, lendo a coluna do banco, que o persistido é o hash e nunca o token que o usuário
  recebeu. Somente testes; nenhuma mudança de comportamento.

## 0.2.2

### Patch Changes

- c33d1c0: O link de magic-link passou a ser verificado a partir de uma mensagem **recebida**.

  Um servidor SMTP real no próprio teste, MIME real por TCP, parse do que chegou, e o link extraído do
  corpo recebido — que então precisa logar o usuário. Sem credencial: roda com `env -i`.

  Achou um modo de falha real: quoted-printable quebra linha na coluna 76 e a URL de magic-link é mais
  longa, então a quebra cai dentro do token (`token=3D…BvU1=` + continuação). Nenhum teste de
  transporte JSON pega isso, e quem usa SMTP passa por ali. O teste prova que a quebra ocorreu antes de
  provar a recuperação.

  Somente testes; nenhuma mudança de comportamento no pacote.

## 0.2.1

### Patch Changes

- 2c0b594: Internal quality: bring every package to `pnpm lint --max-warnings=0` + `prettier`
  compliance (437 pre-existing ESLint errors + workspace formatting). All fixes are
  behavior-preserving — `require-await` resolved by returning `Promise.resolve(...)`
  where a Promise contract is required, `no-unsafe-*` resolved with precise types
  (no `any`), `unbound-method` via property-signatures / arrow wrappers. No public API
  or runtime behavior changes; 665/665 tests remain green.

## 0.2.0

### Minor Changes

- 88fbb04: **BREAKING (pre-1.0, data format):** magic-link tokens are now hashed (SHA-256) before storage — the built-in memory and ORM stores persist `sha256(token)` instead of the raw token, so a store/DB/log leak no longer exposes live credentials (#191). The `MagicLinkStore`/`MagicLinkRepository` interfaces are unchanged (they still receive the raw token; hashing is internal); only the persisted value changes. Existing un-consumed plaintext rows from a prior version will no longer match and will expire naturally within the token TTL (≤15 min default) — no live credential is stranded.

  Also documents (#190) that magic-link tokens are intentionally **unbound bearer credentials** (cross-device by design): `handleCallback` does not validate the OAuth `tx.state`, because magic-link has no redirect round-trip and the click may land on a different device. Security rests on token entropy + short TTL + single-use + hash-at-rest. This supersedes the plan's ADR D6 (which proposed tx.state binding on a false premise).

### Patch Changes

- 70eb7a4: Harden magic-link request handling: the default email resolver now caps the request body it buffers (16 KB) to prevent a large-POST DoS (#204) and narrows its error handling so transport/stream errors propagate instead of being silently swallowed to a null email (#209). The callback URL is built via the URL API (no double slash when the base has a trailing slash), and `magicLink()` now validates `callbackBaseUrl` at construction — throwing `MagicLinkConfigError` if it is not an absolute http(s) URL (#205).
- d9a8e30: Align the plugin cluster to the hardened `@theokit/sdk` 2.18.0 Harness (ecosystem M6). Bumped the `@theokit/sdk` peer + dev dependency from the stale 1.x ranges (`>=1.6.0` / `>=1.0.0` / `>=1.7.0` / `npm:@theokit/sdk@next`) to `^2.18.0` / `>=2.18.0`. The consumed surface (`AuthProvider` / `AuthResult` / `OAuthTransaction` from `@theokit/sdk/server/auth`; `subscribe` for realtime) is stable across 1.x→2.x, so the alignment is a pin bump, not a migration. Also removed the phantom `@theokit/plugin-rate-limit` peer dependency from `plugin-copilot` (no such package exists; its rate-limit config is a type-only opt-in — `no-stubs-no-mocks-no-wired` clean). Validated: all 11 packages typecheck + build + test green against 2.18.0 (661 tests).

All notable changes to `@theokit/auth-magic-link` will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-06-03

### Added

- `magicLink(opts)` factory returns `AuthProvider<MagicLinkProfile, 'magic-link'>` PLUS a `startSignIn(req)` method (magic-link does not use the OAuth `createAuthorizationURL` shape — see README "Wiring").
- 32-byte URL-safe random tokens (43 base64url chars from `crypto.randomBytes`).
- Pluggable `MagicLinkStore` per ADR D7. Two adapters shipped:
  - `createMemoryStore()` — dev/test only. JS event-loop guarantees atomicity for concurrent `consumeToken` calls (EC-11 absorbed).
  - `createOrmStore(repo: MagicLinkRepository)` — production. Atomicity delegated to the Repository contract (UPDATE...RETURNING under the hood for Postgres/MySQL/SQLite).
- Consumer-supplied `sendEmail` callback per ADR D8 — apps wire any transport (Resend, SendGrid, SMTP, console.log for dev). Transport errors propagate (D8 invariant: NEVER swallowed).
- Default token lifetime 15 minutes (configurable via `opts.tokenLifetimeMs`).
- Default `resolveEmail` reads query `?email=` first, then JSON / form-encoded body. Override via `opts.resolveEmail` for custom request shapes.
- Email validation at input boundary (EC-12 absorbed): missing / blank / malformed email throws `MagicLinkConfigError(code: 'invalid_email')` BEFORE token creation.
- Typed errors: `MagicLinkAuthError` (callback-time: `missing_token`, `invalid_or_expired_token`) + `MagicLinkConfigError` (start-time: `invalid_email`, `use_start_sign_in`).
- 15 tests in `tests/magic-link.test.ts`:
  - 5 store tests (isolation, single-use, EC-11 race, cleanup, expiry)
  - 1 ORM integration test (in-memory `MagicLinkRepository` round-trip)
  - 4 startSignIn tests (token shape + persist + email; EC-12 missing/malformed; D8 propagation)
  - 5 handleCallback tests (success, missing_token, unknown, expired, re-use rejection)

### Internal

- `src/sdk-shim.ts` mirrors `AuthProvider<TProfile, TName>` from `@theokit/sdk/server/auth` until SDK 1.6.0 publishes (T5.1). Drop in T5.2.
- Zero runtime deps beyond Node built-ins.
