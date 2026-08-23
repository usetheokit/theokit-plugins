# @theokit/plugin-email

## 0.2.0

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

## 0.1.5

### Patch Changes

- 03b1b5d: Every published export now carries documentation an editor can show. Previously 63.4% of them did (230 of 363), and two packages showed nothing at all: `@theokit/auth-github` and `@theokit/auth-google` measured 0/4, because their module headers began with `@theokit/...`, which TypeScript parses as a tag name and swallows the whole block — text was written and no reader ever got it.

  Seven docblocks were also stranded above another docblock, so they attached to nothing: the symbol they described shipped undocumented and the text shipped invisible. `defineCopilot`'s documentation, including its full usage example, was one of them.

  Type shapes are unchanged. This is visible to consumers because documentation ships in the `.d.ts`.

## 0.1.4

### Patch Changes

- 1ccbedf: O e-mail de magic-link passou a ser enviado de verdade na suíte e2e.

  A suíte live de e-mail enviava um `<p>marker</p>` montado à mão, então o template que o usuário
  recebe nunca tinha passado pela API real. Agora percorre `magicLink()` → `sendMagicLink()` →
  `ResendProvider` → HTTP real, e afirma o UUID de message-id devolvido pelo Resend antes de alegar
  nada sobre o conteúdo.

  Não prova entrega: o destinatário é o endereço de sandbox `resend.dev` (aceita e descarta) e a chave
  é restrita a envio, então a mensagem não pode ser lida de volta. Somente testes.

- 64fa27a: A compatibilidade entre `sendMagicLink()` e a porta `sendEmail` do `@theokit/auth-magic-link`
  passou a ser verificada com os dois pacotes reais, em vez de afirmada contra o tipo local.

  Quatro asserções percorrem o caminho que o usuário percorre: token cunhado e persistido, template
  renderizado, URL extraída do HTML como um cliente de e-mail faria, `handleCallback` aceitando. Uma
  mutação de 4 caracteres na URL do href derruba 3 delas — o que a suíte anterior não detectava.

  Somente testes; nenhuma mudança de comportamento no pacote publicado.

## 0.1.3

### Patch Changes

- 6fb5786: Fix `idempotencyKey`: it never reached Resend's deduplication.

  The key was written into `payload.headers`, which are MIME headers of the message. Resend deduplicates on the `Idempotency-Key` **HTTP request header**, which the SDK exposes only through the second argument of `emails.send` (`CreateEmailRequestOptions`). So the key travelled as a decorative message header and Resend never deduplicated anything — anyone relying on it to make a retry safe (webhook redelivery, queue reprocessing) **sent the email twice**, while the README stated it worked.

  Now passed as `send(payload, { idempotencyKey })`. Custom `headers` still travel with the message, untouched.

  Found by the new live e2e suite on its first real run: the same key twice returned two different message ids. The unit test had asserted `payload.headers['Idempotency-Key']` under the name "maps to Idempotency-Key HTTP header" — both cannot be true, so it passed while the behaviour was wrong. Verified against the real API: two sends with one key now return the same id.

  No API change for consumers: `EmailMessage.idempotencyKey` is the same field, it just works now.

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

- de5df40: `defineEmailProvider` now validates its argument and fails fast with a typed `TypeError`
  when the provider is null/not-an-object, has a missing/empty `name`, or a non-function
  `send` — a malformed provider crashes at wiring time instead of on the first `send()`.
  Mirrors `defineRealtimeProvider`. Valid providers are unaffected (still returned unchanged).

## [Unreleased]

## [0.1.0] - 2026-06-04 (initial publish on `@next`)

Per plan [`p7-plugin-email-plan.md`](../../../.claude/knowledge-base/plans/p7-plugin-email-plan.md) v1.0 and blueprint [`p7-plugin-email-blueprint.md`](../../../.claude/knowledge-base/discoveries/blueprints/p7-plugin-email-blueprint.md) v1.0 (SHIPPABLE 100/100). Form 4 Hybrid — `EmailProvider` interface + Resend default + React Email opt-in peer + canonical magic-link template helper.

### Added

- **`EmailProvider`** interface — `{name, send(message: EmailMessage): Promise<SendResult>}`.
- **`EmailMessage`** + **`SendResult`** typed shapes. `EmailMessage.idempotencyKey` field for deduplication.
- **`EmailSendError`** typed error wrapping provider-side failures.
- **`defineEmailProvider(impl)`** helper for consumer-custom providers (SMTP/SES/SendGrid).
- **`ResendProvider({apiKey | client})`** factory — canonical Resend SDK wrapper. Maps `idempotencyKey` → `Idempotency-Key` HTTP header (ADR D5). Throws `EmailSendError` on Resend error response.
- **`ResendSendPayload`** + **`ResendClientLike`** structural types for tests + custom client injection.
- **`defineEmailTemplate<T>(name, render)`** typed template factory returning `{name, render: (props: T) => Promise<RenderedTemplate>}`.
- **`renderReactEmail(component)`** — dynamic `import('@react-email/render')` bridge with actionable error when peer absent (ADR D3 — optional peer keeps zero-cost path).
- **`sendMagicLink(provider, opts)`** — returns a `SendMagicLinkFn`-compatible function for wiring with `@theokit/auth-magic-link` (ADR D4 — no circular dep; type-only inline contract).
- **`defaultMagicLinkHtml`** + **`defaultMagicLinkText`** — plain-string magic-link templates with appName HTML escaping + expiry-minutes hint. No React Email required.
- **`SendMagicLinkOptions`** with customizable `from` / `appName` / `subject` / `renderHtml` / `renderText` / `idempotencyKey` fields.

### Notes

- **Resend is REQUIRED peer.** Consumer installs `resend@>=3.0.0`. Plugin imports types at compile time; runtime via dynamic import OR consumer-supplied `client`.
- **React Email is OPTIONAL peer.** `@react-email/render` + `@react-email/components` + `react` ship as optional peers. Consumers writing plain HTML strings pay zero cost.
- **`@theokit/auth-magic-link` is NOT a dep.** Plugin re-declares the `SendMagicLinkFn` shape inline to avoid runtime coupling. Consumers wire both packages independently.
- **Idempotency via Resend header passthrough.** No plugin-side store (Resend dedups server-side).
- **No auto-route-registration.** Consumer wires their own routes; plugin provides composable helpers.

### Security threats addressed

| Threat           | Mitigation                                                             |
| ---------------- | ---------------------------------------------------------------------- |
| Replay attacks   | Idempotency-Key header dedup via Resend                                |
| Secret leakage   | API key from env vars; plugin never logs                               |
| XSS in templates | Default magic-link template HTML-escapes user-controlled appName       |
| Error swallowing | EmailSendError typed errors propagate; never silenced                  |
| Provider lock-in | EmailProvider interface — swap transports without rewriting call sites |

### Quality gates

- 28 unit + integration tests GREEN (10 provider + 3 templates + 2 render-react-email + 13 magic-link).
- `npx tsc --noEmit`: exit 0.
- `npx tsup`: `dist/index.js` 5.52 KB + `dist/index.d.ts` 10.03 KB.
- Zero plugin-side runtime deps. All deps via peers.

### Deferred (Onda 2 calendar window ~2026-07-15+)

- **dogfood-app smoke test** — wire `ResendProvider({apiKey: process.env.RESEND_API_KEY})` + magic-link route + manual smoke OR mocked-provider CI gate.
- **npm publish** via `pnpm publish --tag next --access public`.
