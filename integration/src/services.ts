/**
 * The service registry — the single place that knows which credentials each
 * plugin needs, and what a live test can actually do with them.
 *
 * `exercise` RECORDS how far an unattended run can cover the path. It does not decide it:
 * nothing branches on this field. Its two readers are the readiness report, which prints it
 * beside the service, and the `.env.example` generator, which puts it in a comment. What
 * actually decides is the suite author, by reaching for `describeLive` or
 * `describeManualOAuth` — so this field and that choice can disagree, and only a human
 * reading both would notice.
 *
 * It said "load-bearing … not decoration" until #96 measured the two call sites. Saying so
 * mattered: a reader who believed it would assume changing `api-key` to `oauth-redirect`
 * changed what runs, when it changes one printed word.
 *
 * - `api-key` — a static credential the plugin sends on every call (Resend,
 *   Stripe, OpenAI, Groq, OpenRouter). The full path runs anywhere, including
 *   CI, with no human in the loop.
 *
 * - `oauth-redirect` — a three-legged flow. The plugin can build the authorize
 *   URL and can exchange a code, but obtaining that code requires a browser and
 *   a human clicking "allow". So the server half is testable and the round trip
 *   is not, and those suites say which half they covered instead of implying
 *   both.
 *
 * Only plugins whose OWN code talks to a third party are listed. That exclusion
 * is a finding, not an omission, and it is recorded here so nobody has to redo
 * the analysis:
 *
 *   plugin-db-drizzle  reads DATABASE_URL but never connects — it registers CLI
 *                      verbs and a devtools tab, and hands the URL to the
 *                      consumer's drizzle-kit. Nothing to reach.
 *   plugin-realtime    Redis appears only in comments and a doc example. The
 *                      shipped providers are in-memory and Yjs, both local.
 *   plugin-canvas      renders mermaid/markdown in-process.
 *   plugin-forms       zod + react-hook-form, no network.
 *
 * A live suite for any of those would be a unit test with extra latency.
 *
 * NAMING CONSTRAINT, learned the hard way: variable names here double as GitHub
 * Actions secret names, and the API refuses to create any secret whose name
 * starts with `GITHUB_` ("Secret names must not start with GITHUB_."). The GitHub
 * OAuth variables were originally `GITHUB_OAUTH_*` and would have been silently
 * empty in CI forever — `secrets.GITHUB_OAUTH_CLIENT_ID` resolves to nothing and
 * the suite would have skipped every night reporting a missing credential nobody
 * could add. They are `GH_OAUTH_*` for that reason, not for brevity.
 */

/** How far an unattended run can exercise the credential. Reported, never branched on — see the module docblock. */
export type Exercise = 'api-key' | 'oauth-redirect'

/** One credential the service needs, and how a human obtains it. */
export interface CredentialVar {
  /** Environment variable name. */
  readonly name: string
  /** What it is, in one line. */
  readonly what: string
  /** Where to get it — a console path, not just a hostname. */
  readonly where: string
}

export interface ServiceSpec {
  /** Stable id; also the directory name under `tests/`. */
  readonly id: string
  /** Human label used in test output. */
  readonly label: string
  /** Workspace package under test. */
  readonly pkg: string
  /** Third party this plugin actually calls. */
  readonly provider: string
  readonly exercise: Exercise
  /** Credentials without which nothing runs. */
  readonly credentials: readonly CredentialVar[]
  /**
   * Credentials a suite reads but the service does not need to be considered ready.
   *
   * Their absence skips ONE suite and leaves the rest running, so they must not gate the
   * service — but they are real variables the code reads, so they must be mapped in CI and must
   * appear in `.env.example`. Without this slot the only place to put one was prose: GROQ_API_KEY
   * lived inside the voice `caveat` and was hand-appended to the .env.example generator, which
   * left both CI gates blind to it because they iterate the registry (#80).
   */
  readonly optionalCredentials?: readonly CredentialVar[]
  /**
   * Where a live test is allowed to write, or what it is allowed to spend on.
   * Separate from `credentials` because a key proves who you are, not where it
   * is safe to act — every one of these must point at a throwaway target.
   */
  readonly target: readonly CredentialVar[]
  /** Anything that stops this service running unattended, or that costs money. */
  readonly caveat?: string
  /**
   * Path to a live suite that lives OUTSIDE this package, when duplicating it
   * here would be redundant.
   *
   * Only for coverage that genuinely exists and genuinely runs. Reported by
   * readiness so "no suite here" is never mistaken for "not covered" — the two
   * are different, and conflating them is the failure this package exists to
   * avoid.
   */
  readonly coveredElsewhere?: { readonly path: string; readonly why: string }
}

export const SERVICES: readonly ServiceSpec[] = [
  {
    id: 'email',
    label: 'Email (Resend)',
    pkg: '@theokit/plugin-email',
    provider: 'Resend',
    exercise: 'api-key',
    credentials: [
      {
        name: 'RESEND_API_KEY',
        what: 'Resend API key, `re_…`',
        where: 'resend.com/api-keys → Create API key (sending access is enough)',
      },
      {
        name: 'RESEND_FROM_ADDRESS',
        what: 'Verified sender address the key is allowed to send as',
        where:
          'resend.com/domains → verify a domain, then use any address on it. Resend refuses an unverified from-address, so this cannot be arbitrary.',
      },
    ],
    target: [
      {
        name: 'EMAIL_TEST_RECIPIENT',
        what: 'Mailbox the test may deliver into',
        where:
          'Any mailbox created for this and nothing else. Every message carries a run marker, so search `theokit-e2e` to find what the suite sent.',
      },
    ],
    caveat:
      'Sends real email. Resend free tier covers this comfortably, but the mailbox will accumulate messages — the suite does not delete them.',
  },
  {
    id: 'payments',
    label: 'Payments (Stripe)',
    pkg: '@theokit/plugin-payments',
    provider: 'Stripe',
    exercise: 'api-key',
    credentials: [
      {
        name: 'STRIPE_SECRET_KEY',
        what: 'Stripe TEST-mode secret key, `sk_test_…`',
        where:
          'dashboard.stripe.com/test/apikeys — must be the test key. A live key here would move real money.',
      },
    ],
    target: [
      {
        name: 'STRIPE_TEST_RECURRING_PRICE_ID',
        what: 'RECURRING price id in test mode, for the subscription-mode assertion',
        where:
          "Same throwaway product as STRIPE_TEST_PRICE_ID, with a recurring interval. Kept separate from the one-time price on purpose: Stripe refuses each in the other's mode, and the suite asserts both refusals, so one id cannot serve both.",
      },
      {
        name: 'STRIPE_TEST_PRICE_ID',
        what: 'ONE-TIME price id in test mode the suite may build a checkout session for',
        where:
          'dashboard.stripe.com/test/products → create a product with a one-time price. It must NOT be recurring: StripeProvider hardcodes mode:"payment", and Stripe refuses a recurring price in that mode ("You specified `payment` mode but passed a recurring price"). Point this at a throwaway product — the one in use is named "theokit-e2e — do not use", not anything from a real catalogue.',
      },
    ],
    caveat:
      'Test mode only. The readiness report refuses to treat a key that does not start with sk_test_ as ready, and the sk_test_ prefix is re-asserted on the response of a real call (session ids come back cs_test_…), not just at credential-check time. Sessions are not cleaned up; they expire in 24h. The INBOUND leg is not covered by this suite and is not coverable by it: nothing here receives a webhook Stripe actually transmitted, and a signature produced by our own process (generateTestHeaderString) proves our wiring, not their format. That gap is closed by `pnpm flow:stripe-webhook`, which opens a real tunnel — see the README. Measured 2026-08-18 and deliberately NOT asserted here: GET /v1/events?types[]=… does not validate the event type, so a fabricated name returns HTTP 200 with an empty list, exactly like a valid one with no matches. The EVENT_MAP is verified by the tunnel script instead, which reaches 5 of 7 entries against real events.',
  },
  {
    id: 'payments-abacatepay',
    label: 'Payments (AbacatePay)',
    pkg: '@theokit/plugin-payments',
    provider: 'AbacatePay',
    exercise: 'api-key',
    credentials: [
      {
        name: 'ABACATEPAY_API_KEY',
        what: 'AbacatePay SANDBOX API key, `abc_dev_…`',
        where:
          'app.abacatepay.com → Integração → API → Nova chave, with the Dev Mode switch on. Requires 2FA on the account (the key-creation dialog asks for a TOTP code). Scope "Leitura e escrita" is enough — "Completo" grants more than these tests need. Deliberately NOT named ABACATE_PUBLIC_KEY: it is a secret Bearer key, and this integration also has a genuinely public key (ABACATEPAY_DOCUMENTED_PUBLIC_KEY, the HMAC constant), so calling the secret one "public" invites treating it as safe to expose — including in a GitHub secrets list.',
      },
    ],
    target: [
      {
        name: 'ABACATEPAY_TEST_PRODUCT_ID',
        what: 'One-off product id (`prod_…`) the suite may build a checkout for',
        where:
          'POST /products/create with { externalId, name, price, currency: "BRL" } and no `cycle`. Measured: `currency` is required and the docs\' minimal example omits it. The one in use is named "theokit-e2e — do not use".',
      },
    ],
    caveat:
      'Sandbox only — the readiness report refuses a key that does not start with abc_dev_, and every resource created comes back devMode:true. Nothing is cleaned up; the products and charges stay in the sandbox dashboard. NOT COVERED, with the KIND of block and the date it was last measured, because the three are not alike: (1) subscriptions — PROVIDER CAPABILITY, so it may lift without warning. /subscriptions/create answers "PIX Automático is not available for this store". Re-measured 2026-08-24 and unchanged. Note when re-checking that this message is the LAST gate: a wrong API version answers "Not found", a wrong payload answers "Property \'items\' is missing", and a product without a cycle answers "No subscription product with cycle found for billing" — stopping at any of those would wrongly read as the block having lifted. (2) verifyWebhook — STRUCTURAL, and cannot lift from here: delivery needs a public HTTPS endpoint, and signing a payload ourselves would only prove our HMAC agrees with our HMAC. A tunnel closes it, as pnpm flow:stripe-webhook does for Stripe. Unchanged 2026-08-24. The refund happy path was listed here until 2026-08-24 and never belonged: tests/payments-abacatepay/live.test.ts covers it, and did so in the same commit that added this caveat (97aaf84) — the claim was false on the day it was written, not stale, which is why the entries above now carry dates.',
  },
  {
    id: 'copilot',
    label: 'Copilot (OpenRouter LLM)',
    pkg: '@theokit/plugin-copilot',
    provider: 'OpenRouter',
    exercise: 'api-key',
    credentials: [
      {
        name: 'OPENROUTER_API_KEY',
        what: 'OpenRouter API key, `sk-or-…`',
        where: 'openrouter.ai/keys → Create key, and add a small credit balance',
      },
    ],
    target: [
      {
        name: 'COPILOT_TEST_MODEL',
        what: 'Model slug to spend on, e.g. `openai/gpt-4o-mini`',
        where:
          'openrouter.ai/models — pick a cheap one. The existing in-package probe measured ~$0.000032 per round trip on gpt-4o-mini.',
      },
    ],
    caveat: 'Costs money per run, in fractions of a cent. Keep the prompt short.',
    coveredElsewhere: {
      path: 'packages/plugin-copilot/tests/integration/copilot-real-llm.test.ts',
      why: 'It needs an in-memory CopilotRealtimeProvider fixture that the package does not export, and it already drives the whole path — defineCopilot + CopilotRuntime + Agent.prompt + OpenRouter — so a copy here would assert the same thing twice. Gated on E2E_LIVE as well as the key, so `pnpm test` cannot spend money. Run: E2E_LIVE=1 pnpm --filter @theokit/plugin-copilot exec vitest run tests/integration/copilot-real-llm.test.ts',
    },
  },
  {
    id: 'voice',
    label: 'Voice (OpenAI / Groq)',
    pkg: '@theokit/plugin-voice',
    provider: 'OpenAI (TTS + STT), Groq (STT)',
    exercise: 'api-key',
    credentials: [
      {
        name: 'OPENAI_API_KEY',
        what: 'OpenAI API key, `sk-…` — used for both TTS and STT',
        where: 'platform.openai.com/api-keys',
      },
    ],
    target: [
      {
        name: 'VOICE_TEST_TTS_VOICE',
        what: 'Voice id to synthesize with — one of alloy, echo, fable, onyx, nova, shimmer',
        where: 'Any of the six the plugin accepts (see VALID_VOICES in options.ts)',
      },
    ],
    optionalCredentials: [
      {
        name: 'GROQ_API_KEY',
        what: 'Groq API key — lights up the Groq STT backend; without it that one suite skips and the OpenAI path still runs',
        where: 'console.groq.com/keys',
      },
    ],
    caveat:
      'Costs a fraction of a cent per run: one short tts-1 sentence plus one whisper transcription of the ~1s clip it produces. Note the variable is OPENAI_API_KEY, not OPEN_AI_API_KEY — the plugin itself falls back to the former (DEFAULT_STT_ENV_VAR/DEFAULT_TTS_ENV_VAR), so the other spelling looks configured and silently is not.',
  },
  {
    id: 'auth-github',
    label: 'Auth (GitHub OAuth)',
    pkg: '@theokit/auth-github',
    provider: 'GitHub OAuth',
    exercise: 'oauth-redirect',
    credentials: [
      {
        name: 'GH_OAUTH_CLIENT_ID',
        what: 'OAuth app client id',
        where: 'github.com/settings/developers → New OAuth App',
      },
      {
        name: 'GH_OAUTH_CLIENT_SECRET',
        what: 'OAuth app client secret',
        where: 'Same app → Generate a new client secret',
      },
    ],
    target: [
      {
        name: 'GH_OAUTH_CALLBACK_URL',
        what: 'Callback URL registered on the app',
        where:
          'Same app → Authorization callback URL. GitHub rejects an exchange whose redirect_uri does not match, which is one of the things worth asserting.',
      },
    ],
    caveat:
      'Only the token exchange is reachable unattended. Measured 2026-08-17: unauthenticated, /login/oauth/authorize answers 302 → /login BEFORE validating anything, so a fabricated client_id — even an empty one — gets the same 302 as the real app. Any "GitHub accepted our authorize URL" assertion therefore passes with no credential at all, and redirect_uri mismatch is enforced only after login. Both were written, measured, and deleted. RE-MEASURED 2026-08-24 and unchanged: the authorize endpoint answers 302 -> github.com/login without a session cookie. The blocker is therefore a SESSION CREDENTIAL, not a browser — a headless browser without a session gets the same 302, so automating this means storing a live user account session in CI. That is an account rather than a scope-limited token, and every alternative grant (device flow, App installation token, PAT) exercises a different code path than the one under test. Closed locally by `pnpm flow:github`.',
  },
  {
    id: 'auth-google',
    label: 'Auth (Google OIDC)',
    pkg: '@theokit/auth-google',
    provider: 'Google OIDC',
    exercise: 'oauth-redirect',
    credentials: [
      {
        name: 'GOOGLE_OAUTH_CLIENT_ID',
        what: 'OAuth 2.0 client id',
        where: 'console.cloud.google.com/apis/credentials → Create OAuth client ID (Web)',
      },
      {
        name: 'GOOGLE_OAUTH_CLIENT_SECRET',
        what: 'OAuth 2.0 client secret',
        where: 'Same credential → client secret',
      },
    ],
    target: [
      {
        name: 'GOOGLE_OAUTH_REDIRECT_URI',
        what: 'Redirect URI registered on the client',
        where: 'Same credential → Authorised redirect URIs',
      },
    ],
    caveat:
      'Same three-legged limit as GitHub. What IS fully testable here is discovery: the plugin fetches Google’s real OIDC document, and that is a live contract with no human in it. RE-MEASURED 2026-08-24: with the real client id and no cookies, the authorize endpoint answers 302 -> accounts.google.com/v3/signin/identifier. Same conclusion as GitHub — the blocker is a SESSION CREDENTIAL, not a browser. Until 2026-08-24 this provider had no `flow:*` script at all, so the skip message telling a reader to run one pointed at nothing and the success path was exercised by neither CI nor a documented procedure. `pnpm flow:google` now exists; its header records which of its branches have actually been run.',
  },
]

export function serviceById(id: string): ServiceSpec {
  const found = SERVICES.find((s) => s.id === id)
  if (found === undefined) throw new Error(`unknown service id: ${id}`)
  return found
}

/** Every variable name the registry knows about, credentials and targets alike. */
/**
 * The master switch every live suite is gated on.
 *
 * Deliberately NOT a member of any `ServiceSpec`: it proves nothing, points at nothing, and its
 * absence does not skip one suite — it skips ALL of them, and the job still exits 0. A green
 * tick over zero provider calls is the single most convincing way to believe in coverage that
 * does not exist, so the workflow mapping is gated on its own rather than through the registry
 * loop (#80).
 */
export const RUN_SWITCH_VAR = 'E2E_LIVE'

export function allVariableNames(): string[] {
  return SERVICES.flatMap((s) => [
    ...s.credentials,
    ...s.target,
    ...(s.optionalCredentials ?? []),
  ]).map((c) => c.name)
}
