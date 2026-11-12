---
'@theokit/plugin-voice': patch
---

Re-attach the `VoiceControllerBase` docblock to the class: the upload-cap helpers had been inserted between them, so the published declaration shipped the class undocumented.
