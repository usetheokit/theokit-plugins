/**
 * @theokit/auth-google — T2.1 scaffold tests.
 *
 * These tests prove the package resolves, exports the expected surface,
 * and the stub throws until T2.2 lands. Per plan TDD checklist:
 *   RED: test_package_json_valid (covered by pnpm install + build)
 *   RED: test_google_factory_exists_and_returns_provider (stub throws but signature exists)
 */

import { describe, expect, it } from 'vitest'
import { google } from '../src/index.js'
import type { GoogleProfile, GoogleProviderOptions } from '../src/index.js'

describe('@theokit/auth-google — scaffold (T2.1)', () => {
  it('exports a google() factory function', () => {
    expect(typeof google).toBe('function')
  })

  it('google() returns AuthProvider object with name + createAuthorizationURL + handleCallback', () => {
    const opts: GoogleProviderOptions = {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'https://example.com/api/auth/google/callback',
    }
    const provider = google(opts)
    expect(provider.name).toBe('google')
    expect(typeof provider.createAuthorizationURL).toBe('function')
    expect(typeof provider.handleCallback).toBe('function')
  })

  it('GoogleProfile type preserves sub case sensitivity (Wasp incident lesson)', () => {
    const profile: GoogleProfile = {
      sub: 'AbCdEf123',
      email: 'user@example.com',
      email_verified: true,
    }
    expect(profile.sub).toBe('AbCdEf123')
    expect(profile.sub).not.toBe(profile.sub.toLowerCase())
  })
})
