---
'@theokit/auth-github': minor
'@theokit/auth-google': minor
'@theokit/auth-magic-link': minor
'@theokit/plugin-canvas': minor
'@theokit/plugin-copilot': minor
'@theokit/plugin-db-drizzle': minor
'@theokit/plugin-email': minor
'@theokit/plugin-payments': minor
'@theokit/plugin-voice': minor
---

Requires `theokit@0.50.1` or newer, and the README examples now declare a route policy.

TheoKit 0.50.0 made `.policy()` mandatory on every route: a route without one fails `theokit build`, so that "who may call this" is a decision somebody wrote rather than a default nobody read. The `route()` examples in four of these READMEs predated that and had no policy — a reader who copied one got a build failure from our own documentation.

Every example now declares its policy and says why it is the right one. For the auth packages that is `public`, because a visitor arrives without a session and signing in is what gives them one; for the payments webhook it is `public` because the gateway holds no session of ours and the signature is the authentication.

The peer floor moves from `>=0.48.7` to `>=0.50.1` for the same reason it moved in the tests: these packages are built, tested and documented against 0.50.1 and against nothing older. The previous range admitted versions nobody here verifies. If you are on `theokit@0.48.x`, the previous release of these packages still installs.
