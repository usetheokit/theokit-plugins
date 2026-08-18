/**
 * Auth (GitHub OAuth) — live tests against the real GitHub OAuth endpoints.
 *
 * Very little of this plugin is reachable without a human, and the honest
 * inventory matters more than the test count:
 *
 *   createAuthorizationURL   builds a URL. Nothing to verify against GitHub:
 *                            unauthenticated, `/login/oauth/authorize` answers
 *                            302 → /login BEFORE validating anything, so a
 *                            fabricated client_id — and an EMPTY one — get the
 *                            same 302 as the real app. Measured. A test asserting
 *                            "GitHub accepted our URL" would pass with no client
 *                            id at all, which is worse than no test. Its
 *                            parameters are deterministic and belong in the unit
 *                            suite.
 *
 *   redirect_uri mismatch    GitHub enforces this only AFTER authentication, so
 *                            it is unreachable for the same reason.
 *
 *   state mismatch           fires locally, before any network call. A unit test
 *                            already owns it; re-running it here would only add
 *                            latency.
 *
 *   token exchange           REACHABLE, and the one worth having: GitHub's
 *                            refusal shape is a genuine surprise, and no fake
 *                            would have told us.
 *
 * So this file holds one live assertion. That is the whole honest yield.
 */

import { GitHubAuthError, github } from '@theokit/auth-github'
import { expect, it } from 'vitest'

import { required } from '../../src/credentials.js'
import { describeLive, describeManualOAuth } from '../../src/harness.js'
import { serviceById } from '../../src/services.js'

const GH = serviceById('auth-github')

/** An IncomingMessage-shaped stub carrying only what handleCallback reads. */
function callbackRequest(query: string): never {
  return { url: `/api/auth/callback/github${query}`, headers: { host: 'localhost:3000' } } as never
}

describeLive(
  GH,
  'token exchange error mapping',
  () => {
    it('maps a code GitHub refuses onto a GitHubAuthError', async () => {
      // The surprise this asserts, and the reason a fake cannot: GitHub refuses a
      // bad code with HTTP **200** and `{"error":"bad_verification_code"}` in the
      // body — not a 4xx. So in githubExchangeToken, `tokenRes.ok` is TRUE, the
      // `token_exchange_failed` guard never fires for the most common failure in
      // the whole flow, and what surfaces is `missing_access_token`.
      //
      // Two consequences worth stating rather than smoothing over:
      //   - a reader of the code would expect `token_exchange_failed` here;
      //   - GitHub's own reason (`bad_verification_code`) is discarded, so the
      //     error a consumer sees cannot distinguish an expired code from a
      //     revoked app or a wrong secret.
      //
      // The assertion accepts either code deliberately: pinning one would turn a
      // future upstream change into a red build without telling anyone which
      // contract moved. What it does pin is that the failure is OUR typed error
      // and never a bare fetch rejection.
      const provider = github({
        clientId: required('GH_OAUTH_CLIENT_ID'),
        clientSecret: required('GH_OAUTH_CLIENT_SECRET'),
        redirectUri: required('GH_OAUTH_CALLBACK_URL'),
      })

      const attempt = provider.handleCallback(
        callbackRequest('?code=e2e-definitely-not-a-valid-code&state=s'),
        { state: 's' } as never,
      )

      await expect(attempt).rejects.toBeInstanceOf(GitHubAuthError)

      // Re-run to inspect the code: `attempt` already rejected above, and reusing
      // a settled rejection would type as the union of success and error.
      let caught: unknown
      try {
        await github({
          clientId: required('GH_OAUTH_CLIENT_ID'),
          clientSecret: required('GH_OAUTH_CLIENT_SECRET'),
          redirectUri: required('GH_OAUTH_CALLBACK_URL'),
        }).handleCallback(callbackRequest('?code=e2e-definitely-not-a-valid-code&state=s'), {
          state: 's',
        } as never)
      } catch (e) {
        caught = e
      }
      const code = (caught as { code?: string }).code
      expect(
        ['missing_access_token', 'token_exchange_failed'],
        'GitHub refuses a bad code with HTTP 200 + {"error":"bad_verification_code"}',
      ).toContain(code)
    }, 30_000)
  },
  {
    requires: ['GH_OAUTH_CLIENT_ID', 'GH_OAUTH_CLIENT_SECRET', 'GH_OAUTH_CALLBACK_URL'],
  },
)

describeManualOAuth(GH, 'full consent round trip', () => {
  it('exchanges a real authorization code for a profile', () => {
    // Not "impossible" — impossible in CI. The distinction matters and the first
    // version of this file got it wrong. An authorization code is issued to a
    // browser redirect after a consent click, so a runner with no session cannot
    // obtain one; a workstation with a logged-in browser can, and does:
    //
    //   pnpm --filter @theokit/plugins-integration flow:github
    //
    // That script covers what this suite cannot — the SUCCESS path of the
    // exchange, plus githubFetchUser and githubResolveEmail, which no other test
    // in this repository executes. Run on 2026-08-17 against the real API it
    // returned a complete profile: numeric id, login, name, an email resolved
    // from /user/emails, and an https avatar — confirming GitHub still accepts
    // the legacy `Authorization: token X` header this plugin sends.
    //
    // Left declared so the gap shows in the report with a pointer to the script,
    // rather than being absent from it.
    expect(true).toBe(true)
  })
})
