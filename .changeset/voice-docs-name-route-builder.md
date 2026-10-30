---
'@theokit/plugin-voice': patch
---

The README and the docblocks in the published types name `route()` instead of `defineRoute` (#231)

The README told readers to wire each endpoint "via `defineRoute`", and four docblocks that ship in
the `.d.ts` files said the same. theokit exports no `defineRoute` from any subpath. The builder is
`route()` from `theokit/server/define`, and the text now says so. No runtime code changed.
