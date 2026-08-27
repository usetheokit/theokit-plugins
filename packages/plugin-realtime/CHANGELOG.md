# @theokit/plugin-realtime

## 0.2.2

### Patch Changes

- Raise the `theokit` peer floor from `>=0.4.0-beta.0` to `>=0.50.1`, matching every other package here.

  The old floor was a leftover from the beta line, fifty minor versions below what this package is actually built and tested against. It was decorative — nothing in `src/` imports `theokit` — which is exactly why it went stale unnoticed.

  It stopped being decorative when a gate started installing the bottom of every declared range: pinning `theokit@0.4.0` (published, deprecated) and hoisting it made `theokit/client` in a sibling package resolve to a version predating half its surface. A range nobody could sensibly be on was breaking a check for everybody.

  Nothing installable changes for a real consumer. `@theokit/plugin-realtime@0.2.1` cannot work against `theokit@0.4.0` — the room-mounting and server-scanner conventions it documents did not exist there — so the narrowed range describes what was already true.

## 0.2.1

### Patch Changes

- b950fb7: Drop the `lib0` peer dependency, which no published version could satisfy.

  The package declared `lib0: "^1"`. npm's latest `lib0` is `0.2.117`, and the entire `1.x` line is prereleases (`1.0.0-rc.0` … `rc.26`) — which `^1` excludes, because the range carries no prerelease tag. So the peer matched nothing installable, while `yjs` and `y-protocols` both depend on `lib0@^0.2.x`.

  Nothing imported it. The provider dynamically imports `yjs` and `y-protocols/awareness.js`, and the error it raises when they are missing already told consumers to `pnpm add yjs y-protocols` — no `lib0`.

  Removing an optional peer that nobody could satisfy breaks nobody. `yjs` and `y-protocols` are unchanged.

## 0.2.0

### Minor Changes

- 564b8eb: A client subscribing to a Yjs room now receives the document's current state, instead of an empty one until somebody types. The second person to open a document sees what the first wrote.

  It arrives as one ordinary `yjs-update` frame delivered to that subscriber alone, so nothing on your side needs to distinguish it — in Yjs a full state encoding _is_ an update. Its `connectionId` is `@theokit/plugin-realtime#server`, because the frame comes from the room rather than from a participant.

  **Behaviour change worth checking:** a subscriber to a non-empty room receives one frame it did not receive before. If you have a test asserting an exact frame count on join, it will need updating — types are unchanged, so `tsc` will not tell you.

  Still not persisted: a room with no participants and no subscribers is garbage-collected and its document destroyed, so someone arriving after the last person leaves gets an empty document.

- 0747544: `RoomProvider` takes an optional `sender` port, so presence updates and broadcasts can leave the
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

- 20bf284: `useYDoc()` returns the room's document instead of throwing.

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
    be dropped in silence on a provider without Yjs support, and _applied_ on one with it — writing
    document state into a room whose descriptor never opted in. Note that any client can now trigger
    this rejection on any room: catch on your `dispatchFrame` route, as the README's snippet does.
  - **A corrupt frame no longer ends the whole subscription.** One bad payload used to take presence
    and broadcast down with it.

## 0.1.4

### Patch Changes

- 46b22c8: Seven `@theokit/*` peer dependencies that no package imported are removed.

  Each appeared in the source only inside comments — several of them in comments explaining the
  structural shape chosen precisely to AVOID depending on the package, and one in
  `plugin-payments` stating outright that "plugin doesn't take a peerDep on a specific
  @theokit/orm version". A peer nobody imports is not inert: it drags its own dependency tree into
  the consumer's resolution, which is how `@theokit/plugin-forms` became impossible to install
  with npm (#64).

  Removed: `@theokit/sdk` from plugin-canvas and plugin-realtime, `@theokit/orm` from
  plugin-db-drizzle and plugin-payments, and `@theokit/plugin-canvas`, `@theokit/plugin-voice` and
  `@theokit/ui` from plugin-copilot. Nothing imported them, so no consumer code changes.

- db67bbc: Removes `RoomContextValue.subscribe`, which nothing called.

  It was the only writer to the provider's listener set, and nothing called it — so the notify loop
  ran over an empty set on every frame. Neither `RoomContext` nor `RoomContextValue` is exported,
  so it was unreachable from outside the module too.

  No behaviour change: `setStateAndNotify` still keeps `stateRef` in step with the state the frame
  loop reads, which is the reason it exists.

- 8d1f897: A client that reconnects stays in the room.

  Presence is keyed by `connectionId` and `leaveRoom` deletes by that key alone. A tab that reloads
  drops its socket without telling the server, so the dead subscription's generator only noticed at
  its next frame — by which point the same user had reconnected under the same id, and the dead
  session's `release()` removed the LIVE registration. The room saw the reconnecting client vanish,
  and everyone else received a `left` frame for somebody who had just joined.

  The runtime now records which handle owns each `(room, connectionId)`, so a superseded release is
  a no-op. The subscription is still dropped either way — a stale handle's frame listener must go.

## 0.1.3

### Patch Changes

- 617483a: Uma edição Yjs passou a chegar aos outros clientes (#53).

  `applyYjsUpdate` aplicava os bytes no `Y.Doc` do servidor e **não notificava ninguém** — nenhum
  observer no doc, nenhum `fanout` do tipo `yjs-update`. O autor via o próprio estado local e nenhum
  outro cliente recebia nada. O mesmo valia para `applyYjsAwareness`, então cursores remotos nunca
  apareciam.

  Efeito colateral do defeito: o ramo binário do `frameToOutput`, que codifica bytes em base64 para o
  fio JSON, era código morto — nada produzia o frame que ele convertia.

  Os bytes recebidos são rebroadcast (O(update), não O(documento)) e o autor **não** é excluído do
  fanout: Yjs é idempotente, e o frame carrega `connectionId` para o consumidor filtrar o próprio.

## 0.1.2

### Patch Changes

- 2c0b594: Internal quality: bring every package to `pnpm lint --max-warnings=0` + `prettier`
  compliance (437 pre-existing ESLint errors + workspace formatting). All fixes are
  behavior-preserving — `require-await` resolved by returning `Promise.resolve(...)`
  where a Promise contract is required, `no-unsafe-*` resolved with precise types
  (no `any`), `unbound-method` via property-signatures / arrow wrappers. No public API
  or runtime behavior changes; 665/665 tests remain green.

## 0.1.1

### Patch Changes

- d9a8e30: Align the plugin cluster to the hardened `@theokit/sdk` 2.18.0 Harness (ecosystem M6). Bumped the `@theokit/sdk` peer + dev dependency from the stale 1.x ranges (`>=1.6.0` / `>=1.0.0` / `>=1.7.0` / `npm:@theokit/sdk@next`) to `^2.18.0` / `>=2.18.0`. The consumed surface (`AuthProvider` / `AuthResult` / `OAuthTransaction` from `@theokit/sdk/server/auth`; `subscribe` for realtime) is stable across 1.x→2.x, so the alignment is a pin bump, not a migration. Also removed the phantom `@theokit/plugin-rate-limit` peer dependency from `plugin-copilot` (no such package exists; its rate-limit config is a type-only opt-in — `no-stubs-no-mocks-no-wired` clean). Validated: all 11 packages typecheck + build + test green against 2.18.0 (661 tests).
- 3e7af67: Harden the server subscription bridge against mid-stream aborts and slow consumers (#195, #198). The abort listener is now registered before the `handleConnection` await (and an already-aborted signal is handled up front), so an abort during connection setup is observed instead of leaving the generator blocked forever and leaking the connection handle + listener; the listener is removed on both the error and normal/abort exit paths. The per-subscription frame queue is now bounded (`MAX_QUEUED_FRAMES`): on overflow the connection is disconnected (close code 1013, "try again later") so the client reconnects and resyncs rather than the server buffering without limit, and `onFrame` drops frames once stopped/aborted. No public API change.
- be6ec38: Guard the Yjs provider against applying an update to a destroyed/garbage-collected `Y.Doc` (#194). In-flight `applyYjsUpdate`/`applyYjsAwareness` ops now hold a per-room refcount; `gcIfEmpty` defers both doc destruction and room eviction while the count is non-zero, so a concurrent `leaveRoom` can no longer destroy the doc mid-apply. An apply that still races room eviction is a safe no-op (post-await membership re-check) instead of touching a destroyed doc. This also closes the orphan where a room GC'd while its doc was still initializing leaked the `Y.Doc` (never destroyed). No public API change.
- 962b42e: Fix a check-then-act race in the Yjs provider where concurrent `applyYjsUpdate`/`applyYjsAwareness` calls on a fresh room could each construct a `Y.Doc`, orphaning the first (and its `Awareness`) (#193). Doc creation is now memoized with a per-room single-flight promise so concurrent applies share exactly one `Y.Doc`; if init fails, the memo is cleared so a later apply can recreate it (no permanently bricked room). The redundant second `loadYjs()` per apply is also removed — `ensureYjs` returns the loaded modules in its bundle (#196). No public API change.
- ca041df: Fail loudly when a room declares `storage: "yjs"` but is wired to a provider without Yjs support (#197). Dispatching a Yjs update/awareness frame to such a room now throws `RealtimeError` (`yjs_provider_unsupported`) instead of silently dropping the frame and losing CRDT document state — the misconfiguration surfaces immediately. Rooms that do not declare `storage: "yjs"` are unaffected: a stray Yjs frame remains a no-op. No public API change.
- 342239f: Reduce the cyclomatic complexity of eight audit-flagged functions (CC 16–24) by extracting behavior-preserving named helpers (#182–#189). No behavior change and no public API change — all existing tests stay green. Touched: `github()`'s callback (auth-github); `createInMemoryArtifactStore`, `serializeArtifactForCopy`, and `classifyRemoved` (plugin-canvas); `defineCopilot` (plugin-copilot); the realtime subscription effect (plugin-realtime); and `handleSttRequest`/`handleTtsRequest` (plugin-voice). Six functions now measure CC ≤ 10; `serializeArtifactForCopy` (a 9-kind discriminated-union exhaustive switch) and the in-memory `memList` sit at the idiomatic floor — `lizard`'s TypeScript parser mis-merges their adjacent module helpers into one range, overstating the per-function number, but each real function is ≤ 10.

## [Unreleased]

## [0.1.0] - 2026-06-04 (initial; unpublished — gated on @theokit/sdk@1.7.0 @next)

Per plan [`p9-plugin-realtime-plan.md`](../../../.claude/knowledge-base/plans/p9-plugin-realtime-plan.md) v1.0 and blueprint [`p9-plugin-realtime-blueprint.md`](../../../.claude/knowledge-base/discoveries/blueprints/p9-plugin-realtime-blueprint.md) v1.0 (SHIPPABLE 99.2/100). Form 4 Hybrid: `RealtimeProvider` interface + `MemoryRealtimeProvider` default + `YjsRealtimeProvider` opt-in + `defineRealtimeProvider` extension. Consumes G8 `@theokit/sdk/subscription` for WS transport.

### Added

- **`RealtimeProvider`** interface — `{name, joinRoom, leaveRoom, broadcast, updatePresence, getPresence, subscribeRoom, applyYjsUpdate?, applyYjsAwareness?}` (D1).
- **`createMemoryRealtimeProvider()`** — zero-dep in-process default; per-room `Map<connectionId, Presence>` LWW; fanout via `subscribeRoom` listeners (D6).
- **`createYjsRealtimeProvider({maxUpdateBytes?})`** — Yjs CRDT-backed provider; dynamic `import('yjs')` + `import('y-protocols/awareness.js')` peers; lazy Y.Doc + Awareness per room; binary update size cap (default 1 MB) per blueprint EC-7 (D2).
- **`defineRealtimeProvider(impl)`** — type-asserting helper for consumer-supplied adapters (Liveblocks / PartyKit / Cloudflare DO / Redis).
- **`defineRoom({id, presence, broadcast, storage?, authorize?})`** — typed room factory (D3); G6 router-convention mirror.
- **`RealtimeRuntime`** class — registry of room descriptors + bridges WS frames to providers; validates presence + broadcast frames via Zod at dispatch boundary; runs `authorize` hook on connection (D5).
- **`RealtimeConnectionHandle`** — release-on-disconnect semantics; idempotent.
- **`mountRealtime({runtime, rooms, inputSchema?})`** — builds per-room subscription handlers ready to wire into G8 `defineSubscription` (D5).
- **3 typed error classes** — `RealtimeError` (base) + `RealtimePresenceError` (carries Zod `issues`) + `RealtimeBroadcastError` + `RealtimeRoomNotFoundError` + `RealtimeAuthorizationError`.
- **`@theokit/plugin-realtime/react` sub-path** — `RoomProvider` + `useRoom` + `useOthers` + `usePresence` + `useUpdateMyPresence` + `useBroadcast` + `useYDoc` (D4). Peer React `>=18 || >=19` optional.
- **Wire format** — `RealtimeFrame` discriminated union (`joined`/`left`/`presence-changed`/`broadcast`/`yjs-update`/`yjs-awareness`); binary Y bytes base64-encoded for JSON-safe transport in `RealtimeSubscriptionOutput`.

### Notes

- **`@theokit/sdk@>=1.7.0` REQUIRED peer.** Consumer installs `@theokit/sdk@next` (or `latest` once promoted ~2026-07-15+). Plugin uses structural types (no hard SDK import) so workspace develop works against G8 develop branch (`sdk@1.7.0`).
- **Node 22+ required.** CF Workers / Bun / Deno per-runtime adapters deferred to v0.x as separate packages OR via consumer-supplied `defineRealtimeProvider` (D8).
- **Yjs `^13` pinned.** Liveblocks canonical (`@liveblocks/yjs:peerDependencies.yjs ^13`). Yjs ^14 RC explicitly excluded (lib0 internals diverged).
- **React hooks are upstream-write deferred.** v0.1 ships local-state read hooks (useRoom/useOthers/usePresence) + optimistic-merge updater (useUpdateMyPresence). Server-side write loop (G8 subscribe upstream `.send()`) lands when G8 client API stabilizes upstream send — currently AsyncGenerator is read-only.
- **`useYDoc` throws in v0.1.** Y.Doc auto-wiring through React Context is deferred to v0.x; use `YjsRealtimeProvider` directly server-side.

### Out of scope v0.1 (deferred to v0.x)

- **CF Workers DO adapter** with hibernation — ADR D8 defers; partykit-complexity 2-week spike.
- **Bun + Deno adapters** — same trajectory as G8 D426.
- **Liveblocks DevTools-style panel** — defer to G4 follow-up plugin; Chrome DevTools Network → WS covers debugging.
- **theokit-side scanner Vite plugin** for `app/rooms/**/*.ts` auto-mount — cross-repo follow-up.
- **`@theokit/plugin-realtime-react` sibling package** — rejected per D4; same package + sub-path is canonical.
- **dogfood-app cursors-in-canvas demo** — post-implementation session.
- **npm publish** via `pnpm publish --tag next --access public` — calendar-gated ~2026-07-15+ aligned with G8 sdk@1.7.0 → @next promote cohort.

### Security threats addressed

| Threat                  | Mitigation                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| Unauthorized broadcast  | `defineRoom({authorize?: (ctx) => boolean})` per-room hook; G11 `defineAuth` runs at WS upgrade boundary |
| Presence flooding       | Consumer wires P#10 plugin-rate-limit at upgrade; `RealtimeRuntime.getPresence()` for ops visibility     |
| Yjs update poisoning    | `maxUpdateBytes` cap (default 1 MB); throws `RealtimeError({code:'yjs_update_oversized'})`               |
| Y.Awareness oversized   | Same `maxUpdateBytes` cap via `applyYjsAwareness`                                                        |
| Cross-room data leakage | Runtime enforces `roomId` scoping; isolation test in `tests/memory-provider.test.ts:44`                  |
| PII leakage in presence | Zod schema at `defineRoom` boundary; README recommends opt-in fields                                     |

### Quality gates

- 48 unit + integration tests GREEN (6 types + 7 defineRoom + 4 provider + 7 memory + 7 yjs + 8 runtime + 2 presence-multi-client integration + 3 Yjs Awareness integration + 4 React hooks).
- `npx tsc --noEmit`: exit 0.
- `npx tsup`: `dist/index.js` 18.46 KB + `dist/index.d.ts` 12.69 KB + `dist/react/index.js` 4.93 KB + `dist/react/index.d.ts` 3.54 KB.
- `npm pack --dry-run`: 28.0 KB tarball / 9 files (zero test-file leak).
- React tests via `@vitest-environment jsdom` directive (vitest 4 compatibility).

### Deferred (calendar-gated)

- **dogfood-app cursors-in-canvas smoke test** — wire `RoomProvider({roomId: "canvas", client: Theokit})` + cursor MouseMove handler.
- **npm publish** via `pnpm publish --tag next --access public`.
- **Real R2/MinIO etc external infra smoke** — N/A (P#9 is presence/CRDT plugin; no external infra).
