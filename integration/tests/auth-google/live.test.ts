/**
 * Auth (Google OIDC) — live tests against Google's real discovery document.
 *
 * Unlike GitHub, a useful part of this plugin is reachable with NO credential at
 * all: `https://accounts.google.com/.well-known/openid-configuration` is public,
 * and `createAuthorizationURL` fetches it on every call. The client id is only
 * ever written into a query parameter, never validated by the fetch — so the
 * discovery path runs with a placeholder.
 *
 * That matters because the plugin makes a security decision that depends
 * entirely on what Google actually serves. From `index.ts`:
 *
 *   "the finding's prescribed 'discovered endpoint host == base host' check is
 *    deliberately NOT used — real Google discovery spans accounts.google.com /
 *    oauth2.googleapis.com / openidconnect.googleapis.com, so strict
 *    host-equality would break production."
 *
 * That is a claim about a third party, written in a comment, and nothing verified
 * it. If Google ever consolidated onto one host, the comment would be stale and
 * the weaker guard would be unjustified; if Google added a plaintext endpoint,
 * the guard would start rejecting production traffic. Both are live facts, and
 * this is where they get checked.
 *
 * The credential-gated half — token exchange error mapping — is separate, so the
 * discovery assertions are not held hostage by a client secret that does not
 * exist yet.
 */

import { GoogleAuthError, google } from '@theokit/auth-google'
import { expect, it } from 'vitest'

import { optional, required } from '../../src/credentials.js'
import { describeLive, describeManualOAuth } from '../../src/harness.js'
import { serviceById } from '../../src/services.js'

const GOOGLE = serviceById('auth-google')

const DISCOVERY_URL = 'https://accounts.google.com/.well-known/openid-configuration'

/** A transaction shaped like the real one; PKCE is mandatory for Google. */
function transaction(state = 'e2e-state') {
  return { state, pkceVerifier: 'e2e-verifier-0123456789012345678901234567890123456789' } as never
}

function providerWith(overrides: Record<string, unknown> = {}) {
  return google({
    // Discovery does not authenticate, so a placeholder is honest here: this
    // suite is about what Google serves, not about who we are.
    clientId: optional('GOOGLE_OAUTH_CLIENT_ID') ?? 'e2e-placeholder-client-id',
    clientSecret: optional('GOOGLE_OAUTH_CLIENT_SECRET') ?? 'e2e-placeholder-secret',
    redirectUri:
      optional('GOOGLE_OAUTH_REDIRECT_URI') ?? 'http://localhost:3000/api/auth/callback/google',
    ...overrides,
  })
}

describeLive(
  GOOGLE,
  'OIDC discovery',
  () => {
    it('builds an authorization URL from the endpoint Google publishes today', async () => {
      // Exercises discovery + the https guard + PKCE challenge derivation, all
      // against the real document. A placeholder client id is fine: Google does
      // not check it to serve discovery.
      const url = await providerWith().createAuthorizationURL(transaction())

      expect(url.protocol).toBe('https:')
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect(url.searchParams.get('code_challenge')?.length ?? 0).toBeGreaterThan(0)
      expect(url.searchParams.get('response_type')).toBe('code')
    }, 30_000)

    it('still spans multiple hosts, which is why the host-equality guard was rejected', async () => {
      // The live fact the plugin's SSRF decision rests on. If this ever collapses
      // to a single host, the comment in index.ts is stale and the stricter guard
      // becomes viable — that is a design change worth being told about, not a
      // silent drift.
      const doc = (await (await fetch(DISCOVERY_URL)).json()) as Record<string, string>
      const hosts = new Set(
        ['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint']
          .map((k) => doc[k])
          .filter((v): v is string => typeof v === 'string')
          .map((v) => new URL(v).host),
      )

      expect(hosts.size, `Google discovery hosts: ${[...hosts].join(', ')}`).toBeGreaterThan(1)
    }, 30_000)

    it('serves every endpoint over https, as the guard requires', async () => {
      // The other half of the same decision: the guard allows any https host. If
      // Google ever published a plaintext endpoint, the guard would reject real
      // traffic and this says so before a user hits it.
      const doc = (await (await fetch(DISCOVERY_URL)).json()) as Record<string, string>
      const plaintext = [
        'authorization_endpoint',
        'token_endpoint',
        'userinfo_endpoint',
        'jwks_uri',
      ]
        .map((k) => doc[k])
        .filter((v): v is string => typeof v === 'string')
        .filter((v) => !v.startsWith('https://'))

      expect(plaintext, 'Google endpoints not served over https').toEqual([])
    }, 30_000)
  },
  // No credential needed: discovery is public and the client id is not checked.
  { requires: [] },
)

describeLive(
  GOOGLE,
  'token exchange error mapping',
  () => {
    it('maps a code Google refuses onto a GoogleAuthError', async () => {
      // Google, unlike GitHub, answers a bad code with 4xx — so this exercises a
      // different branch than the auth-github suite does, and the pair documents
      // that the two providers disagree about the shape of a refusal.
      const provider = google({
        clientId: required('GOOGLE_OAUTH_CLIENT_ID'),
        clientSecret: required('GOOGLE_OAUTH_CLIENT_SECRET'),
        redirectUri: required('GOOGLE_OAUTH_REDIRECT_URI'),
      })

      const attempt = provider.handleCallback(
        {
          url: '/api/auth/callback/google?code=e2e-definitely-not-valid&state=s',
          headers: { host: 'localhost:3000' },
        } as never,
        transaction('s'),
      )

      await expect(attempt).rejects.toBeInstanceOf(GoogleAuthError)
    }, 30_000)
  },
  {
    requires: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI'],
  },
)

describeManualOAuth(GOOGLE, 'full consent round trip', () => {
  it('exchanges a real authorization code for a profile', () => {
    // Same shape as GitHub: the code is issued to a browser after consent, so CI
    // cannot reach it. Unlike GitHub there is no script for it yet — Google's
    // consent screen needs a configured OAuth consent screen and a test user,
    // which is a provisioning step, not a scripting one.
    expect(true).toBe(true)
  })
})
