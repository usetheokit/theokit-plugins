---
'@theokit/plugin-payments': patch
---

The AbacatePay provider is exercised against the live sandbox API, and three defects came out of it (#41).

Until now every AbacatePay path was written from published documentation and covered only against a fake `fetch`, with the README saying so in a warning block. Twelve live assertions now cover hosted checkout, inline PIX with a payable BR Code, status reconciliation across both resource kinds, a full refund confirmed by **re-reading the charge**, and the typed refusals. Writing them refuted the documentation three times.

**A successful refund was reported as a failure.** The docs show `{ refundPublicId }`; the API returns `{ id, status: "COMPLETE", amount, originalId, createdAt }`. Reading only the documented key made the provider throw `refund_failed` on **every refund that worked** — and no unit test could catch it, because the fake was written from the same docs. Both keys are accepted now, and the fake teaches the measured shape.

**Refund routing by id prefix is restored.** The docs' prefix table claims `/checkouts/refund` accepts `bill_`, `char_`, `pix_char_` and `card_`, which made the branch look like one that could only be wrong — it was removed on exactly that argument. The API: `POST /checkouts/refund { id: "pix_char_…" }` answers `"Use a rota /v2/transparents/refund para reembolsar cobranças transparentes."`

**`methods` is now a provider option, and PIX-only stores need it.** Without it, `/checkouts/create` inherits the API default and answers `"CARD is not available for this store"`, so no checkout could be created at all. AbacatePay has since commented CARD out of its own docs.

```ts
AbacatePayProvider({ apiKey: process.env.ABACATEPAY_API_KEY!, methods: ['PIX'] })
```

Sandbox is enforced, not assumed: a key that does not start with `abc_dev_` is treated as *not configured*, mirroring the `sk_test_` rule, and every resource created comes back `devMode: true`.

Still uncovered, for measured reasons: subscriptions (AbacatePay commented the section out of its docs; the endpoint answers `"PIX Automático is not available for this store"`), inbound webhook delivery (needs a public HTTPS endpoint), and `GET /store/get` (a documented route that answers "Not found").
