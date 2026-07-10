# @theokit/plugin-copilot

## 0.1.2

### Patch Changes

- 2c0b594: Internal quality: bring every package to `pnpm lint --max-warnings=0` + `prettier`
  compliance (437 pre-existing ESLint errors + workspace formatting). All fixes are
  behavior-preserving — `require-await` resolved by returning `Promise.resolve(...)`
  where a Promise contract is required, `no-unsafe-*` resolved with precise types
  (no `any`), `unbound-method` via property-signatures / arrow wrappers. No public API
  or runtime behavior changes; 665/665 tests remain green.
- Updated dependencies [2c0b594]
  - @theokit/plugin-canvas@0.3.3
  - @theokit/plugin-realtime@0.1.2
  - @theokit/plugin-voice@0.7.3

## 0.1.1

### Patch Changes

- b9f9ea3: Charge actual usage instead of a fixed estimate (#174). The agent `complete` event may now carry `usage.costUsd`; when present, the runtime reconciles the budget reservation to that actual cost so `getUsage()` reflects real spend rather than the flat `estimatedCostPerInvocationUsd`. When the provider reports no cost, the estimate is used as the documented fallback. The `CopilotAgentLike` complete-event type gains an optional `usage` field (additive, backward-compatible).
- 34202f8: Make copilot budget accounting race-safe and guard idle triggers (#219, #223, #221). Idle-trigger `runAgent` now goes through the same per-copilot serialization queue as broadcasts, so an idle invocation can no longer run concurrently with a broadcast and double-spend. The budget preflight is replaced by an atomic `reserve` (check + hold the estimate in one synchronous step, single window read), reconciled to the actual cost on success and released on failure/cancellation — closing the TOCTOU/double-spend (#219), the non-atomic window-reset-then-charge (#223), and ensuring a failed invocation does not leak reserved budget (EC-2). An idle trigger that fires during or after `deactivate()` is now a no-op (an `active` flag is flipped first and checked inside every queued task) (#221). Internal `@internal` machinery only — no public API change.
- 3cd718a: Strip forged fence markers from untrusted agent input to a fixpoint (review finding F-sec-2, OWASP LLM01). `frameUntrusted` previously stripped the `<<<UNTRUSTED_USER_INPUT>>>` / `<<<END_UNTRUSTED_USER_INPUT>>>` markers in a single pass, so a nested payload such as `<<<UNTRUSTED_USER<<<UNTRUSTED_USER_INPUT>>>_INPUT>>>` reconstructed a marker after the strip and could escape the untrusted-data fence. The strip now loops until the string stops changing (each pass strictly shrinks it, so it terminates). No public API change.
- 6a6eb0f: Log queued-task failures with copilot/room context instead of swallowing them in an empty catch (#222). The per-copilot queue's error handler now emits a structured `console.error` with `copilotId` + `roomId` + the error, keeping the chain alive while making frame/idle failures observable. No public API change.
- 33dbbb9: Isolate untrusted room text from the agent system prompt to mitigate prompt injection (#218, OWASP LLM01). `framePrompt` no longer prepends the system prompt onto the user message; it returns only a fenced user-role prompt that marks the user's text as untrusted data (and strips any forged fence markers), while the trusted system prompt is passed separately via `streamObject({ systemPrompt })`. Malicious instructions in a broadcast can no longer contaminate the system role. No public API change.
- 9c35fc8: Prune per-room round-robin dispatcher state when a room empties (review finding F-arch-2). `roundRobinCursor` and `roundRobinDecision` are keyed by room id and were never deleted, growing unbounded across long-running processes that cycle through many transient rooms. `unregisterCopilot` now deletes both maps' entries for a room — but only when `copilotsInRoom` is empty after the removal, so a room with remaining copilots keeps its fair-rotation state. No public API change.
- 49aa923: Reconcile the README Quick start with the implemented, tested API (#172, #173). `CopilotProvider` is documented with `userConnectionId` (the real prop) instead of the non-existent `localConnectionId`/`runtime` props, and the headless hooks are shown with their real object-argument signatures (`useCopilotReadable({ description, value })`, `useCopilotTool({ name, description, handler })`) instead of the old positional / `{name, schema}` forms. A new test mirrors the documented Quick start so it compiles and runs against the real API, preventing future doc drift. Docs + test only — no code/API change.
- 70464c5: Release the budget reservation when `setTyping(true)` throws (review finding F-conc-2). The initial typing-indicator update was awaited outside the try block that holds the reservation's reconcile/release, so a throw propagated past the release and left the estimated cost held until the budget window reset. The call is now inside the try, so a failed typing update routes through catch → `release(reservation)`. No public API change.
- d04d3bb: Fix the `round-robin` dispatcher so it rotates fairly across copilots in a room (#220). The cursor is now keyed by room id (not by `frame.connectionId`), and — because `_handleFrame` runs once per copilot — the dispatch decision is memoized per (room, frame) so the cursor advances exactly once per frame. Previously the cursor advanced once per copilot per frame, so every copilot selected itself and round-robin degraded to `all`; it was also keyed by connection, so connections never shared a rotation. Now exactly one copilot responds per frame, rotating across all copilots in the room regardless of which connection sent the frame. No public API change.
- 877a6ee: Pass a real validation schema to `Agent.streamObject` (#224). The runtime previously supplied a passthrough schema (`safeParse` always succeeded), disabling output validation. It now passes `z.object({ text: z.string() })`, so the agent rejects a non-conforming completion instead of silently coercing it. No public API change.
- d9a8e30: Align the plugin cluster to the hardened `@theokit/sdk` 2.18.0 Harness (ecosystem M6). Bumped the `@theokit/sdk` peer + dev dependency from the stale 1.x ranges (`>=1.6.0` / `>=1.0.0` / `>=1.7.0` / `npm:@theokit/sdk@next`) to `^2.18.0` / `>=2.18.0`. The consumed surface (`AuthProvider` / `AuthResult` / `OAuthTransaction` from `@theokit/sdk/server/auth`; `subscribe` for realtime) is stable across 1.x→2.x, so the alignment is a pin bump, not a migration. Also removed the phantom `@theokit/plugin-rate-limit` peer dependency from `plugin-copilot` (no such package exists; its rate-limit config is a type-only opt-in — `no-stubs-no-mocks-no-wired` clean). Validated: all 11 packages typecheck + build + test green against 2.18.0 (661 tests).
- 342239f: Reduce the cyclomatic complexity of eight audit-flagged functions (CC 16–24) by extracting behavior-preserving named helpers (#182–#189). No behavior change and no public API change — all existing tests stay green. Touched: `github()`'s callback (auth-github); `createInMemoryArtifactStore`, `serializeArtifactForCopy`, and `classifyRemoved` (plugin-canvas); `defineCopilot` (plugin-copilot); the realtime subscription effect (plugin-realtime); and `handleSttRequest`/`handleTtsRequest` (plugin-voice). Six functions now measure CC ≤ 10; `serializeArtifactForCopy` (a 9-kind discriminated-union exhaustive switch) and the in-memory `memList` sit at the idiomatic floor — `lizard`'s TypeScript parser mis-merges their adjacent module helpers into one range, overstating the per-function number, but each real function is ≤ 10.
- Updated dependencies [d173838]
- Updated dependencies [d9a8e30]
- Updated dependencies [3e7af67]
- Updated dependencies [be6ec38]
- Updated dependencies [962b42e]
- Updated dependencies [ca041df]
- Updated dependencies [342239f]
- Updated dependencies [db271df]
- Updated dependencies [1d8ee52]
- Updated dependencies [856c667]
- Updated dependencies [c3f3a35]
- Updated dependencies [243e7a6]
- Updated dependencies [9208043]
- Updated dependencies [18fc976]
  - @theokit/plugin-canvas@0.3.1
  - @theokit/plugin-realtime@0.1.1
  - @theokit/plugin-voice@0.7.1

## [Unreleased]

## [0.1.0] - 2026-06-04 (initial; unpublished — gated on @theokit/sdk@1.7.0 + @theokit/plugin-realtime@0.1.0 @next promote cohort)

Per plan [`p11-plugin-copilot-plan.md`](../../../.claude/knowledge-base/plans/p11-plugin-copilot-plan.md) v1.0 + blueprint `p11-plugin-copilot-blueprint.md` v1.0. Form 4 Hybrid: `defineCopilot` factory + `AgentRoomMember` (P#9 RoomMember adapter) + `CopilotRuntime` orchestrator + React `/react` sub-path (`<CopilotProvider>` + `<CopilotChat>` + 6 hooks). Integration plugin composes `@theokit/sdk` Agent + `@theokit/plugin-realtime` (P#9) + opt-in `@theokit/plugin-rate-limit` (P#10) + opt-in `@theokit/plugin-canvas` + `@theokit/plugin-voice` + opt-in `@theokit/ui` composites. Differentiator vs CopilotKit: copilot is a first-class `RoomMember` visible to other users via the presence Map.

### Added

- **`defineCopilot(spec): CopilotDescriptor`** — typed factory with runtime validation. Enforces id pattern, room.id non-empty, agent.name+agent.model required, identity.name required, triggers non-empty, custom trigger needs filter fn, `presence:idle` trigger needs `idleMs > 0`.
- **`AgentRoomMember`** — wraps the copilot as a P#9 `RoomMember`. Connection id is `copilot:<copilotId>` (reserved prefix per EC-8 impersonation guard). Idempotent `join` / `leave`. `setTyping(typing, progress?)` updates presence. `broadcastMessage(text, meta?)` emits a structured `message` event with `{role: "assistant", text, copilotId, ...meta}` payload. `broadcastEvent(event, payload)` emits arbitrary events with copilotId auto-injected.
- **`CopilotRuntime`** — top-level orchestrator. Methods: `registerCopilot/unregisterCopilot/activate/deactivate/getUsage/listCopilotIds/getCopilot`. Wires P#9 `subscribeRoom` → trigger evaluation → `Agent.streamObject` invocation → typing-indicator presence updates → message broadcast.
- **`TriggerEvaluator`** — internal: evaluates `broadcast:<event>` / `presence:idle` / `custom` triggers against `CopilotFrame`. Filters out copilot-prefix frames per EC-4 + EC-8 cost-runaway / impersonation guards. `scheduleIdleCheck` tracks per-room last-seen-ms with setTimeout chain.
- **`BudgetBridge`** — internal: rolling daily + monthly budget tracking per `<copilotId, roomId>` pair. `preflightCheck` throws `CopilotError` on perRequestUsd / dailyUsd / monthlyUsd violations. `charge` accumulates usage. `getUsage` returns `{dailyUsedUsd, monthlyUsedUsd}` snapshot for theo-ui usage-meter integration.
- **`defineCopilotRealtimeProvider(impl): CopilotRealtimeProvider`** — type-asserting identity helper for consumer-supplied realtime providers (Liveblocks / PartyKit / Redis / TheoCloud). Runtime guards verify all 6 required methods present at construction.
- **`ensureVoicePeer` / `ensureCanvasPeer`** — internal: dynamic `import('@theokit/plugin-voice'/'@theokit/plugin-canvas')` with actionable `CopilotConfigError({code: "plugin-voice_missing" | "plugin-canvas_missing"})` when peer absent + config opted in.
- **Dispatcher policy (ADR D6)** — `"first-wins"` (default), `"round-robin"`, `"all"`, OR custom function `(copilots, frame) => string[]`. Bounds same-room cost when multiple copilots share a room.
- **3 typed error classes** — `CopilotError` (base; carries `code` + `cause`) + `CopilotConfigError` (default code `"copilot_config_invalid"`) + `CopilotTriggerError` (default code `"copilot_trigger_failed"`).
- **`@theokit/plugin-copilot/react` sub-path:**
  - `<CopilotProvider>` — React Context root. Subscribes to room frames via `provider.subscribeRoom`, maintains messages/presence/typing/lastError state, broadcasts user input as `inputEvent` (default `"question"`).
  - `<CopilotChat>` — headless reference composite. Renders participants header + messages list + typing indicator + composer + error display + usage meter. `renderMessage/renderParticipants/renderTyping` override props for theme customization. `data-*` attributes for theo-ui composição opt-in.
  - `CopilotContext` + `CopilotContextValue` types.
  - `isCopilotConnectionId(connectionId)` helper.
  - **6 hooks:** `useCopilot()` / `useCopilotMessages()` / `useCopilotPresence()` (filters out localConnectionId + isCopilot=true entries by default) / `useCopilotTyping()` / `useCopilotReadable(key, value)` (registers context; broadcasts `register-knowledge` / `deregister-knowledge` on mount / unmount) / `useCopilotTool(spec)` (registers tool; broadcasts `register-tool` / `deregister-tool` on mount / unmount).
- **Structural type mirrors** — `CopilotRealtimeProvider` mirrors P#9 `RealtimeProvider` interface; `CopilotFrame` mirrors P#9 `RealtimeFrame`; `CopilotAgentLike` mirrors SDK Agent `streamObject` shape. Lets the plugin compile standalone without hard imports of peer source — peers resolve at runtime.

### Notes

- **Peers required:** `theokit@>=0.4.0-beta.0` + `@theokit/sdk@>=1.6.0` + `@theokit/plugin-realtime@>=0.1.0`. **Optional peers:** `@theokit/plugin-rate-limit@>=0.1.0` + `zod@^3.25.0 || ^4.0.0` + `@theokit/ui@>=0.13.0` + `react@>=18 || >=19` + `@theokit/plugin-canvas@>=0.3.0` + `@theokit/plugin-voice@>=0.7.0`. SSE-only / chat-only consumers pay zero for the optional surfaces.
- **Reserved connection-id prefix `copilot:`** — the AgentRoomMember always joins with `copilot:<copilotId>` so frame fanout can distinguish copilot-origin frames at the trigger layer. Humans MUST NOT be allowed to claim a `copilot:*` connection id when joining via the realtime layer (consumer's wire-layer responsibility — EC-8).
- **Dispatcher default is `first-wins`** to bound cost-runaway risk when multiple copilots share a room (ADR D6). `"all"` is opt-in only.
- **Budget rolling windows** — daily resets at UTC `00:00`; monthly resets at first-of-month UTC `00:00`. Resets are computed lazily on next preflight (no background timers).
- **Real-LLM validation** — `tests/integration/copilot-real-llm.test.ts` env-gated by `OPENROUTER_API_KEY` (honest-SKIP per `.claude/rules/real-llm-validation.md` without the key). Validated against `openai/gpt-4o-mini` via OpenRouter; 1057ms round-trip; cost ~$0.000032 per smoke.
- **Voice / Canvas integration are opt-in via peer dynamic-import** — the plugin runs the peer check at `runtime.activate(copilotId)` and throws `CopilotConfigError` (code `"plugin-voice_missing"` / `"plugin-canvas_missing"`) if the peer is absent. Pay zero when not configured.

### Out of scope v0.1 (deferred to v0.x)

- **`<CopilotChat />` polished theme** — v0.1 ships the headless reference; full theo-ui composição (Avatar, MessageBubble, TypingIndicator, etc.) deferred to v0.2 once `@theokit/ui` ships matching primitives.
- **Round-robin dispatcher persistence across runtime restarts** — cursor map is in-process only; v0.2 may add pluggable cursor store.
- **`@theokit/plugin-rate-limit` deep wire** — v0.1 plugin accepts `rateLimit: {tokens, windowMs}` config on the descriptor but the runtime does NOT auto-apply (consumer wires P#10 `withRateLimit` at the WS upgrade boundary today). v0.2 may bind automatically.
- **TheoCloud realtime provider preset** — consumer-supplied via `defineCopilotRealtimeProvider` works today; native preset v0.x.
- **Server-side persistence of conversation transcripts** — runtime emits `onResponse(copilotId, roomId, text)` callback; consumer wires their own store. SDK v1.7.0 conversation API integration v0.x.
- **`useCopilotAction` analog of CopilotKit** — the tool/readable model in v0.1 broadcasts register/deregister events; the copilot agent decides whether to consume. Full action-binding sugar v0.x.
- **dogfood-app smoke** — post-implementation session (post-G8 sdk@1.7.0 promote).
- **npm publish** — calendar-gated ~2026-07-15+ aligned with G8 sdk@1.7.0 + P#9 plugin-realtime@0.1.0 promote cohort.

### Security threats addressed

| Threat                                   | Mitigation                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Cost runaway via copilot-to-copilot loop | `TriggerEvaluator` filters `copilot:*` connectionId frames (EC-4).                                          |
| Copilot impersonation by malicious human | `copilot:` connection-id prefix reserved; runtime never accepts `copilot:*` frame as trigger source (EC-8). |
| Per-request cost spike                   | Opt-in `budget.perRoom.perRequestUsd` preflight emits typed `budget-exceeded` frame instead of agent call.  |
| Rolling cost overrun                     | `budget.perRoom.{dailyUsd, monthlyUsd}` rolling windows reset at UTC day/month boundaries.                  |
| Tool/knowledge registry injection        | `useCopilotReadable` / `useCopilotTool` broadcast as events; copilot agent decides — no implicit trust.     |
| Trigger ReDoS via malicious event names  | Trigger event names matched via exact-string equality (no regex).                                           |

### Quality gates

- **63 tests across 10 test files: 62 GREEN + 1 honest-SKIP (real-LLM env-gated by `OPENROUTER_API_KEY`).** With key: T4.2 real-LLM PASS at 1057ms against `openai/gpt-4o-mini` via OpenRouter (~$0.000032 USD per run).
  - Unit: types (5) + provider (3) + define-copilot (10) + agent-room-member (9) + budget-bridge (7) + voice-canvas-bridge (6) + trigger-evaluator (7) + runtime (11) = 58 tests.
  - Integration: copilot-room-multi-user (3) + copilot-real-llm (1 + 1 honest-SKIP-pair) = 5 tests.
- `npx tsc --noEmit`: exit 0.
- `npx tsup`: dual entry — `dist/index.js` + `dist/react/index.js` + `dist/index.d.ts` + `dist/react/index.d.ts` + sourcemaps.
- `npm pack --dry-run`: validates tarball (zero test-file leak).
- Zero stubs / Mock / Stub / Fake exports in `src/` (per `no-stubs-no-mocks-no-wired.md`).

### Deferred (calendar-gated ~2026-07-15+)

- **dogfood-app smoke test** — wire `CopilotRuntime` + `<CopilotChat>` in dogfood-app once P#9 + sdk@1.7.0 are promoted to `@latest`. Chrome MCP visual roundtrip with real LLM.
- **npm publish** via `pnpm publish --tag next --access public`.
- **Real OpenRouter CI smoke** — `OPENROUTER_API_KEY` env-gated workflow with cost cap.
