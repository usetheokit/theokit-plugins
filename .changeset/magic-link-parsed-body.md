---
'@theokit/auth-magic-link': minor
---

`startSignIn` accepts the body a framework already parsed, so the provider composes with a TheoKit
route.

TheoKit hands a route handler a `Request` built without a body and delivers the parsed value
separately as `ctx.body`. `startSignIn(request)` could therefore never reach the address inside a
route: it threw `invalid_email` while the email sat in `ctx.body`. #68 made the type accept a
`Request`; this makes the runtime work.

The new parameter is optional and the resolution order is unchanged — `?email=` still wins, and a
caller that reads the body from the stream is unaffected. Inside a route, pass it through:
`startSignIn(request, body)`.
