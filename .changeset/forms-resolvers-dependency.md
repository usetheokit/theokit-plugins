---
'@theokit/plugin-forms': minor
---

`@hookform/resolvers` moves from `peerDependencies` to `dependencies`, which makes
`npm install @theokit/plugin-forms` succeed.

It was never a consumer contract: `TheoForm` imports `zodResolver` from
`@hookform/resolvers/zod` internally and the consumer never names the package. As a peer it sat
in the consumer's top-level resolution, where npm eagerly satisfies its OPTIONAL peer
`@typeschema/main` — and `@typeschema/zod` pins `zod@^3.23.8` while `@theokit/sdk` requires
`zod@^4.0.0`. Two transitive chains, mutually exclusive, neither of them ours. As a dependency it
resolves inside this package's own subtree and the conflict does not arise.

`react-hook-form` stays a peer, correctly: the consumer holds that instance and passes it around.
