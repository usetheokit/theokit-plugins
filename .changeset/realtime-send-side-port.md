---
'@theokit/plugin-realtime': minor
---

`RoomProvider` takes an optional `sender` port, so presence updates and broadcasts can leave the
client. Supply nothing and behaviour is unchanged; supply a transport and `useUpdateMyPresence` and
`useBroadcast` reach the server, which fans out to every participant.

The hooks were never blocked by a missing channel — the server half has always fanned out, and
`RealtimeRuntime` is public. What was missing was a send-side port, the mirror of the receive-side
`client` the provider already took.

Note that your own frames come back: the provider notifies every listener in the room including the
sender, so a presence patch is applied twice. That is safe because a patch is a merge rather than an
increment — a presence field that accumulated would not be.
