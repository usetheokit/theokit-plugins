---
'@theokit/auth-github': patch
'@theokit/auth-google': patch
'@theokit/auth-magic-link': patch
---

The route examples name the directory that produces the URL they claim.

All three READMEs showed `// server/routes/api/auth/<provider>/start.ts`. TheoKit already serves `server/routes/` under `/api`, so that file answers at `/api/api/auth/<provider>/start` — a reader who registered `/api/auth/<provider>/callback` with GitHub or Google got a 404 on the redirect, and nothing pointed back at the extra directory.

The same path also produced `client.api.auth.<provider>.start.get()` in the generated typed client, with a redundant segment that reads as a typo.

Found by building a consumer app against these examples. `theokit` now refuses the directory at scan time rather than doubling it silently, so following the old examples fails at build instead of at the identity provider's redirect.
