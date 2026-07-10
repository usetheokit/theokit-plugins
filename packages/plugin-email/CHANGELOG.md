# @theokit/plugin-email

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
