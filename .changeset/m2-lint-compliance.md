---
"@theokit/auth-github": patch
"@theokit/auth-google": patch
"@theokit/auth-magic-link": patch
"@theokit/plugin-canvas": patch
"@theokit/plugin-copilot": patch
"@theokit/plugin-db-drizzle": patch
"@theokit/plugin-email": patch
"@theokit/plugin-forms": patch
"@theokit/plugin-payments": patch
"@theokit/plugin-realtime": patch
"@theokit/plugin-voice": patch
---

Internal quality: bring every package to `pnpm lint --max-warnings=0` + `prettier`
compliance (437 pre-existing ESLint errors + workspace formatting). All fixes are
behavior-preserving — `require-await` resolved by returning `Promise.resolve(...)`
where a Promise contract is required, `no-unsafe-*` resolved with precise types
(no `any`), `unbound-method` via property-signatures / arrow wrappers. No public API
or runtime behavior changes; 665/665 tests remain green.
