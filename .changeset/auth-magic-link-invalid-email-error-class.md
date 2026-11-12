---
'@theokit/auth-magic-link': minor
---

An invalid, missing or oversized email in a start-sign-in request now throws `MagicLinkAuthError('invalid_email')` instead of `MagicLinkConfigError`, as the class docs say.

**Breaking:** callers that match `instanceof MagicLinkConfigError` (or `name === 'MagicLinkConfigError'`) on an invalid address must match `MagicLinkAuthError` instead. `invalid_callback_base_url` and `use_start_sign_in` still throw `MagicLinkConfigError`.
