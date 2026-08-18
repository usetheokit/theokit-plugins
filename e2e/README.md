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

## Two kinds of live test, and every plugin has one

**Provider contracts** (`tests/<service>/live.test.ts`) — does the third party
still accept what we send? Only the six plugins that call one can have these.

**The packaging contract** (`tests/consumer/packaged.test.ts`) — if somebody
installs this, does it load at all? **Every** plugin has this one, including the
four with nothing to call, and it is the half whose absence cost the most.

Nothing in `packages/<name>/tests` can answer the second question. Unit tests
import from `src/` through the workspace, so they never touch `dist/`, never
consult `exports`, and never notice a subpath pointing at a file `files` does not
ship. #9 was exactly that shape: imports wrong, unit suites green, failure visible
only once a consumer resolved the package.

It asserts three mechanical things per package — every `exports` subpath resolves
to a file the tarball actually ships (measured with `npm pack --dry-run`, not read
from the working tree), every declared `.d.ts` ships too (a missing one silently
downgrades consumers to `any`, which is worse than a crash), and the main entry
imports with a non-empty barrel. It needs no credentials and no network, so it is
**not** gated on `E2E_LIVE`: a packaging break is not a provider's bad afternoon,
it is ours.

Verified adversarially rather than trusted — planting each defect turns it red:

| planted                      | caught by                                |
| ---------------------------- | ---------------------------------------- |
| subpath → missing file       | `resolves every exports subpath…`        |
| declared `.d.ts` not shipped | `ships the .d.ts every subpath declares` |
| `files` without `dist`       | both, 2 failures                         |

## Which plugins are here, and which are deliberately not

Only plugins whose **own code** calls a third party can have a live test. The
exclusions were measured, and they are findings rather than gaps:

| plugin              | live-testable                                                     | why                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `plugin-email`      | yes                                                               | calls the Resend API                                                                                                                 |
| `plugin-payments`   | yes                                                               | calls the Stripe API                                                                                                                 |
| `plugin-copilot`    | yes                                                               | drives a real LLM through OpenRouter                                                                                                 |
| `plugin-voice`      | yes                                                               | POSTs audio to OpenAI / Groq                                                                                                         |
| `auth-github`       | `tests/auth-github/live.test.ts` + `scripts/full-flow-github.mjs` | **yes** — error path 1/1 in the suite, and the full round trip verified by the script                                                |
| `plugin-db-drizzle` | **no**                                                            | reads `DATABASE_URL` but never connects — it registers CLI verbs and a devtools tab, and hands the URL to the consumer's drizzle-kit |
| `plugin-realtime`   | **no**                                                            | Redis appears only in comments and a doc example; the shipped providers are in-memory and Yjs, both local                            |
| `plugin-canvas`     | **no**                                                            | renders mermaid/markdown in-process                                                                                                  |
| `plugin-forms`      | **no**                                                            | zod + react-hook-form, no network                                                                                                    |

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

| service                | suite                                                                | ran against the real API?                                                                                       |
| ---------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `email` (Resend)       | `tests/email/live.test.ts`                                           | **yes** — 4/4 against the live API, and it found a real bug on the first run                                    |
| `auth-github`          | `tests/auth-github/live.test.ts`                                     | partly — measured against GitHub; the one live assertion needs `GH_OAUTH_CLIENT_SECRET`, gated behind sudo mode |
| `auth-google`          | `tests/auth-google/live.test.ts`                                     | **yes** — 4/4: discovery with no credential, plus the token-exchange refusal                                    |
| `voice` (OpenAI)       | `tests/voice/live.test.ts`                                           | **yes** — 3/3, including a TTS→STT round trip                                                                   |
| `copilot` (OpenRouter) | `packages/plugin-copilot/tests/integration/copilot-real-llm.test.ts` | **yes** — passes against gpt-4o-mini; lives in its package, see below                                           |
| `payments` (Stripe)    | `tests/payments/live.test.ts`                                        | **yes** — 4/4 against the live test-mode API, including the idempotency round trip                              |
| **all 11 packages**    | `tests/consumer/packaged.test.ts`                                    | **yes** — 45 assertions, no credentials needed                                                                  |

The first run is worth recording, because it is the whole argument for this
package existing. Two of the four assertions failed, and neither failure was a
flake:

1. **`expect(result.id).toMatch(/^re_/)`** — Resend returns a **UUID** for a
   message id. `re_` is the prefix of an API _key_. The package's fakes returned
   `re_xxx`, so the fake had taught the wrong contract and this suite inherited
   it. All the unreal ids in the unit tests were replaced with UUIDs.

2. **The idempotency round trip returned two different ids** for one key. That
   was not a bad assertion — it was a real bug (#37). `ResendProvider` wrote the
   key into `payload.headers`, which are MIME headers of the _message_, while
   Resend deduplicates on the `Idempotency-Key` HTTP header of the _request_,
   which the SDK only accepts as `send(payload, { idempotencyKey })`. Every
   consumer relying on it to make a retry safe was sending the email twice, and
   the README said it worked. The unit test asserted `payload.headers[...]` under
   the name "maps to Idempotency-Key HTTP header" — both cannot be true, so it
   passed.

One live run, one wrong assertion of ours corrected, one shipped bug found.

### `payments` and the assertion that was measured, then not written

The Stripe suite carries the same idempotency round trip as `email`, for the
same reason: `StripeProvider` passes the key as the **second** argument of
`sessions.create` — a request option, not a param — and both spellings
type-check. That is precisely the shape of #37. It passed on the first live run,
and to be sure the assertion could fail at all, the #37 defect was planted back
into the provider (key moved into the payload) and the suite went red with two
different session ids; restoring it returned the four greens. An assertion never
seen to fail is an assertion nobody has tested.

A fourth assertion was designed, measured, and deliberately **not** written: a
check that every key of the provider's `EVENT_MAP` is still a real Stripe event
type. `GET /v1/events?types[]=…` looked like the way to ask it. Measured
2026-08-18, `types[]=checkout.session.this_does_not_exist` returns **HTTP 200
with an empty list** — indistinguishable from a valid type with no matching
events. The assertion would have passed with a fabricated event name, which is
the `auth-github` failure again, caught this time before the code existed rather
than after. Stripe publishes no endpoint enumerating valid event types, so that
map stays covered by review.

### The inbound leg, and why the suite cannot cover it

The thirteen assertions above are all OUTBOUND. The webhook path is the other
direction, and until it was measured the coverage looked complete while the
interesting half was missing: `packages/plugin-payments/tests/webhook-crypto.test.ts`
signs its payloads with `stripe.webhooks.generateTestHeaderString`, which is
Stripe's own SDK computing a genuine HMAC — but **the bytes are produced in our
process**. That proves our wiring passes the raw body and header through
unaltered. It cannot prove that what Stripe's infrastructure transmits is what
we know how to verify.

`pnpm --filter @theokit/plugins-e2e flow:stripe-webhook` closes it. `stripe
listen` opens a tunnel, `stripe trigger` makes Stripe create a real event on the
account, and Stripe delivers it — body and `stripe-signature` both theirs. The
receiver is the shipped plugin, `payments({ providers }).handleWebhook`.

It is a script rather than a test because it needs the `stripe` binary and an
outbound tunnel, the same reason `flow:github` is a script. Test mode is
enforced rather than assumed: the CLI config on a developer machine may hold an
`rk_live_` key, so `--api-key` is passed explicitly from `STRIPE_SECRET_KEY` and
refused unless it starts with `sk_test_`.

**What it reaches, stated by tier** (measured 2026-08-18):

| Tier                     | EVENT_MAP entries                                                                   | What is proven                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live delivery            | `checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`    | signature verified against bytes Stripe sent, **and** the mapping                                                                                      |
| Fetched from the account | `checkout.session.expired`, `charge.dispute.created`                                | the mapping, against a real event name Stripe chose. No signature — a fetched event never had one                                                      |
| Unverifiable here        | `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` | nothing. `/v1/events` shows **zero** of each on the account after triggering; they need a delayed-notification method actually completed by a customer |

The middle tier exists because those two events _are_ emitted — `/v1/events`
shows three of each — just minutes to hours after the trigger, on Stripe's
clock. Waiting for them would make the run take an unknown length of time;
fetching them verifies the half that a fetch can verify, and the table says
which half that is.

This also closes, by another route, the check declared impossible above:
`/v1/events?types[]=` accepts a fabricated event name with HTTP 200, so it can
confirm nothing. An event Stripe actually emitted, carrying the name we map,
can.

Two things the suite needs that are easy to get wrong, both now stated in the
registry and in `.env.example`:

- **`STRIPE_TEST_PRICE_ID` must be a ONE-TIME price.** `StripeProvider`
  hardcodes `mode: 'payment'`, and Stripe refuses a recurring price in that mode.
  Every one of the ten active prices on this project's test account is recurring,
  so the suite could not borrow one — it points at a throwaway product named
  `theokit-e2e — do not use`. That the real catalogue is unusable by the neutral
  contract is a finding of its own, filed as #39.
- **A `sk_live_` key makes the whole suite skip**, with that as the printed
  reason. `unsafeReason()` treats a live key as _not configured_, not as
  something to be careful with.

### Why `auth-github` holds exactly one assertion

The first draft had four. Two were deleted after measuring, because they were
worse than nothing:

- _"GitHub accepts the authorize URL we build"_ — **passed with a fabricated
  client id, and with an empty one.** Unauthenticated, `/login/oauth/authorize`
  answers `302 → /login` before validating anything, so the assertion could not
  fail. It looked like coverage of the app registration and covered nothing.
- _"refused when redirect_uri is not registered"_ — GitHub enforces that only
  **after** authentication, unreachable for the same reason.

A third, the state-mismatch guard, fires locally without touching the network, so
it belongs to the unit suite and would only add latency here.

What remains is the token exchange, and it is the one worth having: GitHub refuses
a bad code with HTTP **200** and `{"error":"bad_verification_code"}` — not a 4xx.
So `tokenRes.ok` is true, the provider's `token_exchange_failed` guard never fires
for the most common failure in the flow, and GitHub's own reason is discarded. No
fake would have said so.

### The OAuth round trip: impossible in CI, not impossible

The first version of this package said the consent leg was "unreachable without a
human" and left it at that. That conflated two different things. A CI runner has
no browser session, so it genuinely cannot obtain an authorization code. A
workstation with a logged-in browser can — and the script does it:

```bash
pnpm --filter @theokit/plugins-e2e flow:github
```

It starts a callback listener on port 3000, prints the authorize URL, captures the
code from the redirect, and runs the real `handleCallback`. That covers the three
things the unattended suite cannot reach:

| path                   | what it proves                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| code → access token    | `githubExchangeToken` on the **success** side, not just the refusal                                                                      |
| token → `/user`        | `githubFetchUser`, including that GitHub still accepts the legacy `Authorization: token X` header this plugin sends rather than `Bearer` |
| token → `/user/emails` | `githubResolveEmail`, which needs the `user:email` scope and is otherwise never executed                                                 |

Run against the real API on 2026-08-17 it returned a complete profile — numeric
id, login, name, an email resolved from `/user/emails`, https avatar. The script
reports the SHAPE of each field and never its contents, because that is a real
person's name and address.

Two rules for running it properly, both learned by doing it wrong first:

**Click the button, don't call `click()`.** Driving the consent screen with
injected JavaScript produces an untrusted event and can bypass validation the UI
applies to a real gesture. Use the browser's own input dispatch, which is what a
person's mouse does.

**Revoke before re-running.** Once the app is authorized, GitHub skips the consent
screen and redirects straight through — so a second run quietly exercises a
shorter path than a first-time user takes, and the consent screen itself is never
seen. Revoke at `github.com/settings/connections/applications/<client_id>` first.
Done that way, the screen returned, listed exactly the two scopes requested, and
warned that `localhost:3000` is "Not owned or operated by GitHub" — none of which
the shortcut would have shown.

### `auth-google` verifies a security decision, not just a happy path

Google's discovery document is public, and `createAuthorizationURL` fetches it on
every call — the client id is only written into a query parameter, never checked
by the fetch. So this suite runs with **no credential at all**, and it checks
something a unit test cannot: a claim the plugin makes about a third party.

`auth-google/src/index.ts` deliberately does _not_ implement the reviewer's
prescribed "discovered endpoint host must equal the base host" SSRF check, and
says why in a comment: real Google discovery spans several hosts, so
host-equality would break production. Nothing verified that. Now it does —
measured today:

| endpoint                 | host                           |
| ------------------------ | ------------------------------ |
| `authorization_endpoint` | `accounts.google.com`          |
| `token_endpoint`         | `oauth2.googleapis.com`        |
| `userinfo_endpoint`      | `openidconnect.googleapis.com` |

Three distinct hosts, so the weaker-looking guard is the correct one. If Google
ever consolidates, the suite goes red and the comment stops being true — which is
a design decision worth being told about rather than discovering later. The
companion assertion checks the other side: every endpoint still https, because
the guard allows any https host and would start rejecting real traffic the day one
of them was not.

### When a live suite belongs somewhere else

`copilot` has real coverage and no directory here, and the registry says so
through `coveredElsewhere` rather than letting readiness report it as a gap.
"No suite in e2e/" and "not covered" are different claims, and printing the
first as if it were the second is the exact confusion this package exists to
prevent.

Its probe needs an in-memory `CopilotRealtimeProvider` fixture the package does
not export, and it already drives the whole path — `defineCopilot` +
`CopilotRuntime` + `Agent.prompt` + OpenRouter. Copying it here would assert the
same thing twice.

```bash
E2E_LIVE=1 pnpm --filter @theokit/plugin-copilot exec vitest run tests/integration/copilot-real-llm.test.ts
```

Two things keep that honest. The probe is gated on `E2E_LIVE` as well as the
key, so `pnpm test` cannot spend money on it — which in turn means the nightly
workflow has to invoke it by name, and does. And a readiness assertion checks the
referenced file actually exists: a pointer to coverage that moved is worse than
no pointer, because the report would claim the gap is closed while nothing runs.

### One naming rule, learned by hitting it

Variable names here double as GitHub Actions secret names, and the API refuses
any secret whose name starts with `GITHUB_`:

```
HTTP 422: Secret names must not start with GITHUB_.
```

The GitHub OAuth variables started life as `GITHUB_OAUTH_*`. Nothing local would
have complained — `.env` accepts any name — and the suite would have passed on a
laptop while `secrets.GITHUB_OAUTH_CLIENT_ID` resolved to an empty string in CI
every night, reporting a missing credential that could not be added. They are
`GH_OAUTH_*` for that reason, not for brevity. Check the name before adding a
service, because this failure is invisible until the nightly run.

## Adding a service

1. Create the credentials; `pnpm e2e:readiness` tells you which and where.
2. Put them in `e2e/.env`, and add them as repository secrets for CI.
3. Add the entry to `src/services.ts`, then regenerate `.env.example`.
4. Write `tests/<id>/live.test.ts`. Start from `tests/email/live.test.ts` —
   auth, payload shape, error mapping, in that order.
5. **Run it against the real API before committing.** This repository has just
   spent a cycle removing checks that only looked like coverage; do not add
   another one.
