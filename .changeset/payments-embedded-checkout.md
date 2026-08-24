---
'@theokit/plugin-payments': minor
---

Embedded checkout, and a contract that can express it.

`createCheckout({ uiMode: 'embedded', returnUrl })` returns a `clientSecret` you hand to the
provider's client-side SDK to mount the payment form inside your own page. Proven against real
Stripe, not only typed.

The feature was **unexposed, not unavailable**. Measured live: Stripe accepts `ui_mode: 'embedded'`
and returns a `client_secret` with `url: null` — and the old contract threw on that null URL before
reaching the response. It also could not express the request: Stripe answers
``` `success_url` is not supported with `ui_mode: embedded` ``` to the parameters this package sent.

**Breaking, deliberately.** `CheckoutResult` is discriminated by `uiMode`. Narrow on it to read
`url` (hosted) or `clientSecret` (embedded):

```ts
const result = await provider.createCheckout({ items, successUrl, cancelUrl })
if (result.uiMode === 'hosted') redirect(result.url)
```

`url` could have become optional instead. That would have moved a compile-time guarantee into a
runtime check for every caller who never uses embedded; narrowing keeps the promise where it was.
Hosted calls written before `uiMode` existed still type-check and still mean the same thing —
`ui_mode` is not even sent for them, so the request is byte-identical.

`CheckoutInput` makes the invalid combination unrepresentable: embedded takes `returnUrl`, hosted
takes `successUrl`/`cancelUrl`, and mixing them does not compile.

**AbacatePay:** this adapter does not implement embedded checkout and refuses such a request by
name. Whether the provider offers one is **unverified** — nobody has asked its API, and the
measurement behind this feature was run against Stripe.
