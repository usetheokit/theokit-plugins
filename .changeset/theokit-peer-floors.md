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

The `theokit` peer floor is `>=0.48.7`, the version these packages are actually built against.

The declared floors ranged from `>=0.1.0-alpha.5` to `>=0.4.0-beta.0` while every one of these
packages carries `theokit: ^0.48.7` as its devDependency. Those ranges span the framework's move
from `defineRoute({...})`-style functions to builders, so they admitted versions the code does not
compile against — and the failure would land in a consumer's build, pointing at our package.

Two of the old floors were pre-release versions, which promised compatibility with a version the
framework itself did not consider stable.

Widening a floor again is welcome, and now has a price: a CI job that builds the package against
the version being claimed. `check:manifests` fails when a peer floor drops below the
devDependency the package is built with.
