/**
 * The service registry — the single place that knows which credentials each
 * plugin needs, and what a live test can actually do with them.
 *
 * `exercise` is the load-bearing field. It is not decoration: it decides whether
 * an unattended run can cover the whole path or only part of it.
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
 */

/** How far an unattended run can exercise the credential. */
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
   * Where a live test is allowed to write, or what it is allowed to spend on.
   * Separate from `credentials` because a key proves who you are, not where it
   * is safe to act — every one of these must point at a throwaway target.
   */
  readonly target: readonly CredentialVar[]
  /** Anything that stops this service running unattended, or that costs money. */
  readonly caveat?: string
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
        name: 'STRIPE_TEST_PRICE_ID',
        what: 'Price id in test mode the suite may build a checkout session for',
        where: 'dashboard.stripe.com/test/products → create a product with any price',
      },
    ],
    caveat:
      'Test mode only. The readiness report refuses to treat a key that does not start with sk_test_ as ready.',
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
    caveat:
      'Costs money per run. GROQ_API_KEY is optional and only lights up the Groq STT backend; without it that one test skips and the OpenAI path still runs.',
  },
  {
    id: 'auth-github',
    label: 'Auth (GitHub OAuth)',
    pkg: '@theokit/auth-github',
    provider: 'GitHub OAuth',
    exercise: 'oauth-redirect',
    credentials: [
      {
        name: 'GITHUB_OAUTH_CLIENT_ID',
        what: 'OAuth app client id',
        where: 'github.com/settings/developers → New OAuth App',
      },
      {
        name: 'GITHUB_OAUTH_CLIENT_SECRET',
        what: 'OAuth app client secret',
        where: 'Same app → Generate a new client secret',
      },
    ],
    target: [
      {
        name: 'GITHUB_OAUTH_CALLBACK_URL',
        what: 'Callback URL registered on the app',
        where:
          'Same app → Authorization callback URL. GitHub rejects an exchange whose redirect_uri does not match, which is one of the things worth asserting.',
      },
    ],
    caveat:
      'A full round trip needs a browser and a human clicking "allow", so it cannot run unattended. The suite covers the half that can: the authorize URL it builds, and how a real GitHub refusal of a bad code is mapped.',
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
      'Same three-legged limit as GitHub. What IS fully testable here is discovery: the plugin fetches Google’s real OIDC document, and that is a live contract with no human in it.',
  },
]

export function serviceById(id: string): ServiceSpec {
  const found = SERVICES.find((s) => s.id === id)
  if (found === undefined) throw new Error(`unknown service id: ${id}`)
  return found
}

/** Every variable name the registry knows about, credentials and targets alike. */
export function allVariableNames(): string[] {
  return SERVICES.flatMap((s) => [...s.credentials, ...s.target]).map((c) => c.name)
}
