---
'@theokit/plugin-realtime': minor
---

`useYDoc()` returns the room's document instead of throwing.

Every other piece of the Yjs path already existed and was proven — the provider, the runtime's
inbound handling, both frame kinds in both wire unions, and a real-WebSocket round trip. The React
half was the gap: the hook threw unconditionally, and the reducer dropped `yjs-update` frames
because its frame type had no `bytes` field and its switch had no arm for them.

Pass `ydoc` to `<RoomProvider>` and the document is wired both ways. You construct it — anyone who
wants a `Y.Doc` already has `yjs` installed, and this keeps the peer optional for the majority who
use this package for presence and broadcast only. Nothing is imported eagerly.

Two fixes ship with it, both about a room that never asked for CRDT state. Such a frame used to be
dropped in silence on a provider without Yjs support, and *applied* on one with it; it is now
refused by name from the server, where the room descriptor lives. And a corrupt frame no longer
ends the whole subscription — that one bad payload used to take presence and broadcast down too.
