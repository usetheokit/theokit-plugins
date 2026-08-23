---
'@theokit/plugin-realtime': patch
---

A client that reconnects stays in the room.

Presence is keyed by `connectionId` and `leaveRoom` deletes by that key alone. A tab that reloads
drops its socket without telling the server, so the dead subscription's generator only noticed at
its next frame — by which point the same user had reconnected under the same id, and the dead
session's `release()` removed the LIVE registration. The room saw the reconnecting client vanish,
and everyone else received a `left` frame for somebody who had just joined.

The runtime now records which handle owns each `(room, connectionId)`, so a superseded release is
a no-op. The subscription is still dropped either way — a stale handle's frame listener must go.
