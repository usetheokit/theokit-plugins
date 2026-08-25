# @theokit/plugin-copilot

## 0.5.0

### Minor Changes

- 24dfe32: Requires `@theokit/sdk@4.54.0` or newer, and the auth READMEs name the API that exists.

  All three auth READMEs opened with `import { defineAuth } from '@theokit/sdk/server/auth'`. That function shipped in sdk 2.x and is gone from 4.x, which is what npm serves — so a reader copying the first example imported something that does not exist. The orchestrator is now `Auth.create`, and the options are unchanged.

  Nothing here caught it because these packages tested against `@theokit/sdk@^2.18.0` — a caret on a 2.x version, so two majors behind what a consumer installs. The doc gate that type-checks README examples was checking them against a version nobody has. It now checks against 4.54.0, and that is what surfaced this.

  `@theokit/plugin-copilot` gains a fix of its own: `CopilotAgentLike` could not be satisfied by any real agent. It declared `streamObject<T>(opts: { schema: unknown })` and promised `DeepPartial<T>` out — a `T` no parameter determined — so `@theokit/sdk`'s `Agent`, the only agent this ecosystem ships, was not assignable while the README invited exactly that wiring. It is now parameterised on the schema, as the SDK does.

  The same package's `CopilotFrame` also mirrors every `RealtimeFrame` variant again: `yjs-update` and `yjs-awareness` arrived upstream with collaborative editing and were never copied, which made `@theokit/plugin-realtime`'s provider — a declared peer — unassignable.

  If you are on `@theokit/sdk@2.x` or `3.x`, the previous release of these packages still installs.

### Patch Changes

- 76c0031: `@theokit/plugin-realtime`'s provider can now be handed to `copilot()`, which is what the peer dependency was always promising.

  `CopilotFrame` is a structural mirror of `RealtimeFrame`, kept as a mirror rather than an import so this package takes no hard dependency on the other. The mirror stopped at four variants while the original grew to six: `yjs-update` and `yjs-awareness` arrived with collaborative editing and were never copied across.

  A provider that can emit a frame the listener type does not cover is not assignable to it, so wiring the two together failed at `tsc` with a message about `subscribeRoom` — several layers away from the cause, and only in a consumer's app.

  It drifted unnoticed because the peer was never installed here to test against. It is now, and a type assertion performs the assignment, so the next variant added upstream fails in this package instead of in your app.

## 0.4.0

### Minor Changes

- a76d961: Requires `theokit@0.50.1` or newer, and the README examples now declare a route policy.

  TheoKit 0.50.0 made `.policy()` mandatory on every route: a route without one fails `theokit build`, so that "who may call this" is a decision somebody wrote rather than a default nobody read. The `route()` examples in four of these READMEs predated that and had no policy — a reader who copied one got a build failure from our own documentation.

  Every example now declares its policy and says why it is the right one. For the auth packages that is `public`, because a visitor arrives without a session and signing in is what gives them one; for the payments webhook it is `public` because the gateway holds no session of ours and the signature is the authentication.

  The peer floor moves from `>=0.48.7` to `>=0.50.1` for the same reason it moved in the tests: these packages are built, tested and documented against 0.50.1 and against nothing older. The previous range admitted versions nobody here verifies. If you are on `theokit@0.48.x`, the previous release of these packages still installs.

## 0.3.2

### Patch Changes

- 2b5779a: Widen the `@theokit/sdk` peer range from `^2.18.0` to `>=2.18.0`. These packages work with the current sdk major and the old range said otherwise.

  If you use `create-theokit`, your app pins `@theokit/sdk@^4`. Installing these packages alongside it produced a peer mismatch that **pnpm did not warn about** — you got a combination nobody had declared support for and were not told.

  What the widening rests on, measured against `@theokit/sdk@4.53.1` rather than assumed:
  - the three auth packages import **types only** (`AuthProvider`, `AuthResult`, `OAuthTransaction`), erased at compile time. No sdk code runs in them; the helpers they execute come from `theokit/server/auth`.
  - `plugin-copilot` is the one with a real runtime dependency, and each function it calls was exercised: `Budget.create`, `Budget.get`, `remainingIn`, `preflightCheck`, `chargeAndCheckThresholds`, `computeCost`.

  Unrelated to this change and worth knowing if you use the sdk's auth orchestrator: `Auth.create(...)` cannot complete an OAuth sign-in on any published sdk version — the transaction cookie is written under one name and read under another. Reported as usetheokit/theokit-sdk#376. Composing providers through `route()` is unaffected and works.

## 0.3.1

### Patch Changes

- 8f2475d: Document the plugin this package is. The README's Quick start now registers `copilot()` in
  `theo.config.ts` before defining a copilot, and the npm description names the plugin rather than
  only `defineCopilot`.

  Measured before the change: `copilot(`, `plugins:` and `theo.config` appeared zero times in the
  README. A developer following it exported a `defineCopilot` and stopped — the plugin was never
  registered, `ctx.copilot` was never decorated, and nothing failed, because an unregistered plugin
  is indistinguishable from a plugin nobody wrote.

## 0.3.0

### Minor Changes

- cafe2b4: `<CopilotChat />` no longer lists the local user among the other participants.

  `useCopilotPresence()` filters the local user out only when you pass its connectionId, and
  `CopilotChat` passed nothing — so the header showed the user to themselves, in a variable the
  code calls `otherPresence`. It could not do better: `CopilotContextValue` never exposed the id,
  even though `CopilotProvider` receives it as `userConnectionId` and broadcasts with it.

  `userConnectionId` is now on the context and `CopilotChat` filters by it. The field is OPTIONAL,
  so a hand-built provider — the path `CopilotContext`'s docblock blesses for test harnesses —
  keeps working unchanged, with the unfiltered behaviour it has today.

- f6de463: Framework peer ranges describe the version each package is built against.

  `@theokit/sdk` was declared `>=2.18.0` — unbounded — on the four packages that import it, while
  the published SDK is 4.53.1 and their devDependency pins `^2.18.0`. A consumer on the current SDK
  satisfied the peer, installed without a warning, and received code compiled two majors earlier.
  Narrowed to `^2.18.0`.

  `plugin-canvas` declared `@theokit/ui: ^1.1.0` while building against `^1.3.2`; narrowed to
  `^1.3.2`. No live break there — `DiffViewer` is exported from 1.1.0 — but the range promised
  versions nothing compiles against.

- f71f9bc: The `theokit` peer floor is `>=0.48.7`, the version these packages are actually built against.

  The declared floors ranged from `>=0.1.0-alpha.5` to `>=0.4.0-beta.0` while every one of these
  packages carries `theokit: ^0.48.7` as its devDependency. Those ranges span the framework's move
  from `defineRoute({...})`-style functions to builders, so they admitted versions the code does not
  compile against — and the failure would land in a consumer's build, pointing at our package.

  Two of the old floors were pre-release versions, which promised compatibility with a version the
  framework itself did not consider stable.

  Widening a floor again is welcome, and now has a price: a CI job that builds the package against
  the version being claimed. `check:manifests` fails when a peer floor drops below the
  devDependency the package is built with.

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

## 0.2.0

### Minor Changes

- ae1510c: Delegate spend accounting to `@theokit/sdk` and become a real TheoKit plugin.

  Cost is now priced from the tokens the SDK actually reports, fixing a ceiling that never
  moved because it was reconciled against a field no agent produces (#61). The local budget
  tracker is replaced by the SDK's budget engine, keeping only what the SDK has no equivalent
  for: in-flight holds across the check-then-charge gap, and a per-request cap. `copilot()`
  returns a plugin `theo.config.ts` accepts, publishing read-only usage on `ctx.copilot`.

  Breaking: `monthlyUsd` is a rolling 30-day window rather than a calendar month. Use
  `perRoom.limits` with the SDK's own windows where the exact boundary matters.

### Patch Changes

- 03b1b5d: Every published export now carries documentation an editor can show. Previously 63.4% of them did (230 of 363), and two packages showed nothing at all: `@theokit/auth-github` and `@theokit/auth-google` measured 0/4, because their module headers began with `@theokit/...`, which TypeScript parses as a tag name and swallows the whole block — text was written and no reader ever got it.

  Seven docblocks were also stranded above another docblock, so they attached to nothing: the symbol they described shipped undocumented and the text shipped invisible. `defineCopilot`'s documentation, including its full usage example, was one of them.

  Type shapes are unchanged. This is visible to consumers because documentation ships in the `.d.ts`.

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
