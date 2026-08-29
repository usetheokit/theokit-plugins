---
'@theokit/auth-github': minor
---

Send PKCE on the GitHub authorization code flow when the transaction carries a verifier.

The package documented its absence as a provider limitation — "GitHub OAuth 2.0 ignores PKCE params
(RFC 7636 not implemented)". That was true when written and stopped being true in July 2025.
Measured against the live endpoint rather than read from a changelog: sending
`code_challenge_method=plain` answers *"When utilizing PKCE (RFC 7636), supply both a
code_challenge_method and a code_challenge. The code_challenge_method is expected to be 'S256'."* An
endpoint that ignored the parameters would have rendered the consent screen.

Opt-in, and that is the deliberate difference from `auth-google`, where PKCE is mandatory and a
transaction without a verifier is rejected. Google REQUIRES it; GitHub recommends it. Rejecting a
verifier-less transaction here would break every consumer calling `newTransaction(false)` — a
breaking change in exchange for a defence-in-depth gain, which is not a trade to make on a
consumer's behalf.

`state` was already verified and remains the CSRF defence. PKCE defends a different thing: an
authorization code that leaks through a log, a redirect or a proxy cannot be exchanged without the
verifier.
