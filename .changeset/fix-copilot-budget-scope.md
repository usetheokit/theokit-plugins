---
'@theokit/plugin-copilot': patch
---

Create SDK budgets with the supported `process` scope instead of `agent`, which the SDK rejects as unimplemented. Per-room isolation still comes from distinct budget names.
