---
'@theokit/plugin-payments': patch
---

Compare AbacatePay secrets and signatures with `timingSafeEqual` from `theokit/server/webhook` instead of a private helper.
