---
'@theokit/plugin-voice': patch
---

Cap the speech-to-text upload while reading it: the endpoint now answers 413 `PAYLOAD_TOO_LARGE` and cancels the stream once the body passes the limit, instead of buffering it all. Drop the unused `busboy` dependency.
