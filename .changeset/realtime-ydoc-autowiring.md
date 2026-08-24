---
'@theokit/plugin-realtime': minor
---

`useYDoc()` returns the room's document instead of throwing.

Every other piece of the Yjs path already existed and was proven — the provider, the runtime's
inbound handling, both frame kinds in both wire unions, and a real-WebSocket round trip. The React
half was the gap: the hook threw unconditionally, and the reducer dropped `yjs-update` frames
because its frame type had no `bytes` field and its switch had no arm for them.

Pass `ydoc` to `<RoomProvider>` and live edits flow both ways. You construct the document — anyone
who wants a `Y.Doc` already has `yjs` installed, and this keeps the peer optional for the majority
who use this package for presence and broadcast only. Nothing is imported eagerly. **Keep the
document stable** (`useState(() => new Y.Doc())`); a fresh one each render replaces the document.

**Live edits only.** A client joining a room where a document already has content receives nothing
until somebody types — there is no initial-sync handshake, and the README says so rather than
implying the wiring is complete.

Three fixes ship with it:

- **A Yjs frame now carries base64 in BOTH directions.** The server→client half always encoded,
  because `JSON.stringify(new Uint8Array([1,2]))` yields `{"0":1,"1":2}` and `Y.applyUpdate`
  rejects it. The client→server half had no encoder, so the frame a browser produced could not
  survive the transport this package's own README documents. `dispatchFrame` still accepts a
  `Uint8Array`, so an in-process caller is unaffected.
- **A room that never declared `storage: 'yjs'` refuses CRDT frames by name.** Such a frame used to
  be dropped in silence on a provider without Yjs support, and *applied* on one with it — writing
  document state into a room whose descriptor never opted in. Note that any client can now trigger
  this rejection on any room: catch on your `dispatchFrame` route, as the README's snippet does.
- **A corrupt frame no longer ends the whole subscription.** One bad payload used to take presence
  and broadcast down with it.
