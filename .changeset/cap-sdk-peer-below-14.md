---
'@theokit/auth-github': patch
'@theokit/auth-google': patch
'@theokit/auth-magic-link': patch
'@theokit/plugin-copilot': patch
'@theokit/plugin-realtime': patch
---

Cap the `@theokit/sdk` peer range below 14. The open-ended range let npm pick sdk 15, which the `theokit` peer it resolves beside (`>=5.32.0 <14`) refuses, so a consumer's install failed with ERESOLVE.
