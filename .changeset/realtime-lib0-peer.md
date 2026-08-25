---
'@theokit/plugin-realtime': patch
---

Drop the `lib0` peer dependency, which no published version could satisfy.

The package declared `lib0: "^1"`. npm's latest `lib0` is `0.2.117`, and the entire `1.x` line is prereleases (`1.0.0-rc.0` … `rc.26`) — which `^1` excludes, because the range carries no prerelease tag. So the peer matched nothing installable, while `yjs` and `y-protocols` both depend on `lib0@^0.2.x`.

Nothing imported it. The provider dynamically imports `yjs` and `y-protocols/awareness.js`, and the error it raises when they are missing already told consumers to `pnpm add yjs y-protocols` — no `lib0`.

Removing an optional peer that nobody could satisfy breaks nobody. `yjs` and `y-protocols` are unchanged.
