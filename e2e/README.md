# `@theokit/plugins-e2e`

Live tests. Real credentials, real APIs, real email, real money.

The unit suites in `packages/*/tests` prove this code does what we think against
fakes. They cannot prove the thing that actually breaks in production: that the
contract we coded against is still the contract the provider serves. A fake
agrees with whoever wrote it. Only Resend can tell you that the header it reads
for deduplication is still `Idempotency-Key`.

That is what lives here, and nothing else. These suites do not re-test template
rendering or option validation over the wire; they test **auth reaches the
provider**, **our payload shape is accepted**, and **a real error maps to the
error we claim to return**.

---

## Running

```bash
cp e2e/.env.example e2e/.env     # then fill in what you have
pnpm e2e                         # or: pnpm --filter @theokit/plugins-e2e e2e
pnpm e2e:readiness               # what is configured, what each gap needs
```

Nothing runs without `E2E_LIVE=1`. A stray `pnpm e2e` cannot spend money or send
email.

**`pnpm test` never runs these.** This package deliberately has no `test`
script, so `pnpm -r --filter='./packages/*' run test` — the command CI runs on
every push — cannot reach it. Live tests belong on a schedule and on demand, not
on every pull request: they are slow, they cost money, and a provider's bad
afternoon is not a reason to turn someone's PR red.

---

## Which plugins are here, and which are deliberately not

Only plugins whose **own code** calls a third party can have a live test. The
exclusions were measured, and they are findings rather than gaps:

| plugin                       | live-testable | why                                                                                                                                  |
| ---------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `plugin-email`               | yes           | calls the Resend API                                                                                                                 |
| `plugin-payments`            | yes           | calls the Stripe API                                                                                                                 |
| `plugin-copilot`             | yes           | drives a real LLM through OpenRouter                                                                                                 |
| `plugin-voice`               | yes           | POSTs audio to OpenAI / Groq                                                                                                         |
| `auth-github`, `auth-google` | partly        | see _Two kinds of credential_ below                                                                                                  |
| `plugin-db-drizzle`          | **no**        | reads `DATABASE_URL` but never connects — it registers CLI verbs and a devtools tab, and hands the URL to the consumer's drizzle-kit |
| `plugin-realtime`            | **no**        | Redis appears only in comments and a doc example; the shipped providers are in-memory and Yjs, both local                            |
| `plugin-canvas`              | **no**        | renders mermaid/markdown in-process                                                                                                  |
| `plugin-forms`               | **no**        | zod + react-hook-form, no network                                                                                                    |

A live suite for any of the last four would be a unit test with extra latency.

---

## Two kinds of credential, and why it decides what is testable

This is the distinction the registry and the harness are built around.

**`api-key`** — Resend, Stripe, OpenAI, Groq, OpenRouter. A static credential
sent on every call. The full path runs anywhere, including CI, with no human in
the loop.

**`oauth-redirect`** — GitHub, Google. A three-legged flow. The plugin can build
the authorize URL and can exchange a code, but obtaining that code needs a
browser and somebody clicking "allow". So the **server half is testable and the
round trip is not**, and those suites say which half they covered instead of
implying both.

What is fully testable on the OAuth side, unattended: the authorize URL we
build, how a real provider refusal of a bad code is mapped, and — for Google —
the OIDC discovery document, which is a live contract with no human in it. The
consent leg skips via `describeManualOAuth`, naming the reason.

---

## Rules these tests follow

**Skips are loud.** Vitest reports a skipped test and a passing test with the
same absence of red. Every skip here names the exact variable that was missing,
because "5 skipped, 1 passed" otherwise reads at a glance like six services
passing.

**Targets are throwaway.** Every `*_TEST_*` variable must point at a mailbox,
price or model created for this and nothing else. A credential says who you are;
a target says where it is safe to act. They are separate fields in the registry
for that reason.

**A Stripe live key is refused, not handled carefully.** `unsafeReason()` treats
anything that is not `sk_test_…` as not configured at all, and the readiness
report marks it `UNSAFE`. There is no flag to override that.

**Artifacts are marked.** Everything sent carries a run marker, so anything that
escapes into a real inbox is identifiable as test traffic at a glance.

**No retries.** `retry: 0`. A live suite that retries hides an intermittent
contract break, which is the one thing these tests exist to catch.

**One service at a time.** `fileParallelism: false`. Parallel files race for the
same provider rate limit, and that turns into flakiness that looks like a
product bug.

**Credential values are never printed.** The readiness report answers set or
not-set, never the value, and there is a test asserting it stays that way.

---

## Layout

```
e2e/
├── src/
│   ├── services.ts      the registry — every credential, what it is, where to get it
│   ├── credentials.ts   .env locally, repository secrets in CI; identical names
│   └── harness.ts       describeLive() — skips with a NAMED reason, never silently
├── tests/
│   ├── readiness.test.ts   always runs; reports the gap across every service
│   └── <service>/          one directory per registry id
└── scripts/
    └── env-example.ts      regenerates .env.example from the registry
```

`readiness.test.ts` fails on a test directory with no registry entry. The
reverse — a registered service with no suite yet — is **reported, not failed**,
because a registry entry is also how someone learns which credential to create
first.

`.env.example` is generated, so it cannot drift from what the code reads:

```bash
pnpm --filter @theokit/plugins-e2e env:example
```

---

## Current coverage, stated plainly

| service                                                      | suite                      | ran against the real API?                                                                                    |
| ------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `email` (Resend)                                             | `tests/email/live.test.ts` | **not yet** — written from the provider's documented contract; needs one run with a key before it is trusted |
| `payments`, `copilot`, `voice`, `auth-github`, `auth-google` | none yet                   | registered, so readiness tells you what to create                                                            |

That first row is the important one. **A live test that has never made a live
call is a unit test with extra latency.** The suite is written and typechecked,
and it has not authenticated against Resend even once, because this machine has
no key. Run `pnpm e2e` with `RESEND_API_KEY` set before treating it as coverage,
and fix what the real API says rather than what the fake would have said.

`plugin-copilot` already has a real-LLM probe at
`packages/plugin-copilot/tests/integration/copilot-real-llm.test.ts`. It lives in
the package because it needs `CopilotRuntime` plus an in-memory provider fixture,
and it is now gated on `E2E_LIVE` as well as on the key — otherwise anyone with
`OPENROUTER_API_KEY` in their environment paid for it on every `pnpm test`.

---

## Adding a service

1. Create the credentials; `pnpm e2e:readiness` tells you which and where.
2. Put them in `e2e/.env`, and add them as repository secrets for CI.
3. Add the entry to `src/services.ts`, then regenerate `.env.example`.
4. Write `tests/<id>/live.test.ts`. Start from `tests/email/live.test.ts` —
   auth, payload shape, error mapping, in that order.
5. **Run it against the real API before committing.** This repository has just
   spent a cycle removing checks that only looked like coverage; do not add
   another one.
