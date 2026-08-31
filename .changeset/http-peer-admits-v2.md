---
"@theokit/plugin-canvas": patch
"@theokit/plugin-payments": patch
"@theokit/plugin-voice": patch
---

The `@theokit/http` peer admits 2.x, so these three install again

`>=1.1.1 <2` was an upper bound written before `@theokit/http@2.0.0` existed. `theokit@0.64.0`
depends on `@theokit/http@^2.0.0`, so the ranges were disjoint and `npm i` answered ERESOLVE —
these three packages could not be installed by any npm user alongside the current framework.
pnpm never showed it: it has defaulted `strict-peer-dependencies` to false since v8.

2.0.0 is a behavioural major — a controller route declaring neither a guard nor an explicit
access decision is refused rather than served. It does not reach these packages: each ships an
abstract base with no `@Controller` and no access decoration, deliberately, because the URL
space and the access decision belong to the application that extends it. Nothing here is
dispatched, the imported decorators (`Body`, `Get`, `Post`, `Req`) are unchanged in 2.x, and no
bare `@UseGuards()` — the other thing 2.0.0 stopped honouring — appears in any of them.

The dev dependency moved to `^2.0.0` in the same change. Widening the peer while building and
typechecking against 1.x would have declared a compatibility nothing exercised. Against 2.0.0:
root typecheck clean, build green, 563 tests passing (canvas 232, payments 237, voice 94).

Applications that extend these bases still declare access on their own subclass, and under
`@theokit/http@2` an application that forgets is refused instead of served silently.
