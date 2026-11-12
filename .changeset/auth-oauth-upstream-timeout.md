---
'@theokit/auth-github': minor
'@theokit/auth-google': minor
---

Bound the token, userinfo and email calls with a `timeoutMs` option (default 10000). A timeout rejects with the package's auth error and `code: 'upstream_timeout'`.
