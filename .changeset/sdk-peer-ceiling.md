---
'@theokit/auth-github': minor
'@theokit/auth-google': minor
'@theokit/auth-magic-link': minor
'@theokit/plugin-copilot': minor
'@theokit/plugin-canvas': minor
---

Framework peer ranges describe the version each package is built against.

`@theokit/sdk` was declared `>=2.18.0` — unbounded — on the four packages that import it, while
the published SDK is 4.53.1 and their devDependency pins `^2.18.0`. A consumer on the current SDK
satisfied the peer, installed without a warning, and received code compiled two majors earlier.
Narrowed to `^2.18.0`.

`plugin-canvas` declared `@theokit/ui: ^1.1.0` while building against `^1.3.2`; narrowed to
`^1.3.2`. No live break there — `DiffViewer` is exported from 1.1.0 — but the range promised
versions nothing compiles against.
