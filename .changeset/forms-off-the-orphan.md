---
'@theokit/plugin-forms': minor
---

`TheoForm` takes its `useAction` from `theokit/client` instead of `@theokit/react`.

`@theokit/react` has one version, published once in June, no `repository` field pointing at source, and a `@theokit/sdk ^1.1.0` peer while npm serves 4.x. Because this package required it, installing forms alongside a current SDK produced an unmet peer that nobody had a path to fix — the package cannot be patched by anyone.

The hook now ships in the framework itself (theokit 0.52.1), beside the action protocol that always described itself as the contract for `defineAction` + `useAction`. The peer moves accordingly: `@theokit/react >=1.1.0` becomes `theokit >=0.52.1`, which every consumer of a `<TheoForm>` already has by definition — the `action` it takes comes from theokit's own `@theo/actions` virtual module.

Behaviour is unchanged. A validation failure still arrives with its `fields` map and still reaches react-hook-form through `setError`; the framework hook returns the protocol's own `ActionInputError` rather than a plain object, and `TheoForm` reads `fields` by shape, not by class.
