---
'@theokit/auth-magic-link': patch
'@theokit/plugin-payments': patch
---

The production store example and docblocks no longer name `@theokit/orm` APIs that do not exist. The magic-link README now shows a Drizzle adapter that keeps the single-statement atomic consume, and it is covered by a test over a real SQLite database.
