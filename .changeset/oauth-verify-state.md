---
'@theokit/auth-github': patch
'@theokit/auth-google': patch
---

Check the OAuth callback `state` with theokit's constant-time `verifyOAuthState`. An empty `state` or an empty stored state is now rejected with `state_mismatch`.
