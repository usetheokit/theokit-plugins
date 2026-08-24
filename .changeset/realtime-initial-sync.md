---
'@theokit/plugin-realtime': minor
---

A client subscribing to a Yjs room now receives the document's current state, instead of an empty one until somebody types. The second person to open a document sees what the first wrote.

It arrives as one ordinary `yjs-update` frame delivered to that subscriber alone, so nothing on your side needs to distinguish it — in Yjs a full state encoding *is* an update. Its `connectionId` is `@theokit/plugin-realtime#server`, because the frame comes from the room rather than from a participant.

**Behaviour change worth checking:** a subscriber to a non-empty room receives one frame it did not receive before. If you have a test asserting an exact frame count on join, it will need updating — types are unchanged, so `tsc` will not tell you.

Still not persisted: a room with no participants and no subscribers is garbage-collected and its document destroyed, so someone arriving after the last person leaves gets an empty document.
