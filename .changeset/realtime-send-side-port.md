---
'@theokit/plugin-realtime': minor
---

`RoomProvider` takes an optional `sender` port, so presence updates and broadcasts can leave the
client. Supply nothing and behaviour is unchanged; supply a transport and `useUpdateMyPresence` and
`useBroadcast` reach the server, which fans out to every participant.

The hooks were never blocked by a missing channel — the server half has always fanned out, and
`RealtimeRuntime` is public. What was missing was a send-side port, the mirror of the receive-side
`client` the provider already took.

Also fixes a defect the port made reachable: `dispatchFrame` validated a presence **patch** against
the full room schema, so any room with a required presence field rejected every partial update —
which is the only kind `useUpdateMyPresence` can send. It now validates the patch merged over the
connection's current presence, which is what the code's own comment always claimed.

Note that your own frames come back, and the echo is authoritative: it carries the server's full
presence and replaces your local copy, so a key the room's schema does not declare is stripped when
it arrives.
