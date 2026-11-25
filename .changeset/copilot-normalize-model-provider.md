---
'@theokit/plugin-copilot': patch
---

Parse model ids with the SDK's `parseModelId` and drop the hand-written `computeCost` cast. `splitModelId` (now deprecated) normalizes the provider: it is lowercased and aliased, so `LM-Studio/x` becomes `lmstudio`.
