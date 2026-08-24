---
'@theokit/plugin-forms': patch
---

The README described a headless tier that cannot be reached. It now describes what the package does.

`@usetheo/ui` was listed as **optional** while `package.json` declares it a required peer, and the
"Gotchas" section said `<TheoField>` *"throws at first render … not at module import"*. Measured
against a real consumer layout, neither holds:

```
import('@theokit/plugin-forms')        -> ERR_MODULE_NOT_FOUND: Cannot find package '@usetheo/ui'
import('@theokit/plugin-forms/react')  -> ERR_PACKAGE_PATH_NOT_EXPORTED
```

The package declares exactly one export, and the barrel reaches `<TheoField>`, which imports
`@usetheo/ui` at module scope. So the failure happens when the module graph loads. `useTheoField` is
not an escape hatch from it — there is no second entry point to reach.

**No behaviour changed.** What changed is that the documentation says so, the version range matches
the manifest, and a consumer test pins it, so the day a headless entry point exists the test fails
and asks to be updated.

Why one was not added here: `<TheoForm>` imports `<TheoField>` to build the `TheoForm.Field`
compound, so the barrel reaches it either way, and `splitting: false` would duplicate
`TheoFormContext` and hand a consumer two React contexts — which is what reverted the earlier
attempt. Whether to build one anyway is a decision about the published surface, and it is recorded
rather than made.
