# ADR 0003 — a joining client receives the full document, not a state-vector diff

Date: 2026-08-24
Status: accepted
Context: B-029

## Context

`@theokit/plugin-realtime`'s Yjs provider rebroadcasts each update it receives, which is correct for
propagating a live edit and carries no history. Measured 2026-08-24: a client subscribing to a room
whose document already had content received `[ 'joined' ]` and held `""` — the second person to open
a document saw nothing until somebody typed.

The server holds the full `Y.Doc` per room, so the state was always available. What was missing was a
way to address one client: `fanout` iterates listeners with no identity, and `joinRoom` receives a
`ConnectionInfo` with no channel back. `subscribeRoom` is the only point in the contract holding
both, and is where the sync now fires.

## Decision

On subscribe to a room that already has a document, send that subscriber `encodeStateAsUpdate(doc)`
as an ordinary `yjs-update` frame.

## Alternatives

### A — full-state replay (chosen)

|                       |                                                                      |
| --------------------- | -------------------------------------------------------------------- |
| Round trips           | none                                                                 |
| Bytes                 | O(document), once per subscribe                                      |
| New frame types       | none — a full state is an update, consumed by the same `applyUpdate` |
| Client→server channel | not needed                                                           |

### B — state-vector exchange (rejected, for now)

The y-protocols sync handshake: the client sends its state vector, the server replies with only the
missing delta.

|                       |                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Round trips           | two                                                                                                                                                                  |
| Bytes                 | O(diff)                                                                                                                                                              |
| New frame types       | one, client→server, carrying a vector                                                                                                                                |
| Client→server channel | **needed, and none exists.** `applyYjsUpdate` is the only inbound path and it _applies bytes to the doc_ — a state vector sent through it would corrupt the document |

## Rationale

B wins only when the joining client already holds most of the document. That is **reconnection**, not
first join, and first join is the case measured and reported. Paying two round trips and a new
inbound frame type to optimise a case that does not occur yet is the trade YAGNI refuses
(`rules/parsimony-ladder.md` rung 1).

A's honest cost: a large document is re-encoded once per subscribe. The threshold at which that
matters is **not measured**, and is deliberately not guessed here — B is the upgrade path when
somebody has a document big enough to measure.

Choosing A does not block B. Adding a vector exchange later is additive, and the frame A sends is one
B would also send.

## Consequences

- A subscriber to a non-empty room receives one frame it did not receive before. A consumer counting
  frames sees a behaviour change that `pnpm typecheck` cannot surface; noted in the changeset.
- The frame's `connectionId` is `@theokit/plugin-realtime#server`. Attributing it to a participant
  would be a lie a consumer could act on, since `connectionId` is what lets a client skip its own
  frames.
- Nothing is persisted. A garbage-collected room destroys its document, so a client arriving after
  the last participant leaves still gets an empty one. That is storage, not sync, and it is asserted
  by a test so it is not rediscovered as a bug.
