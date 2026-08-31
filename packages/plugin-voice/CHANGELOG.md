# @theokit/plugin-voice

## 0.11.1-next.0

### Patch Changes

- 2e0b425: The `@theokit/http` peer admits 2.x, so these three install again

  `>=1.1.1 <2` was an upper bound written before `@theokit/http@2.0.0` existed. `theokit@0.64.0`
  depends on `@theokit/http@^2.0.0`, so the ranges were disjoint and `npm i` answered ERESOLVE —
  these three packages could not be installed by any npm user alongside the current framework.
  pnpm never showed it: it has defaulted `strict-peer-dependencies` to false since v8.

  2.0.0 is a behavioural major — a controller route declaring neither a guard nor an explicit
  access decision is refused rather than served. It does not reach these packages: each ships an
  abstract base with no `@Controller` and no access decoration, deliberately, because the URL
  space and the access decision belong to the application that extends it. Nothing here is
  dispatched, the imported decorators (`Body`, `Get`, `Post`, `Req`) are unchanged in 2.x, and no
  bare `@UseGuards()` — the other thing 2.0.0 stopped honouring — appears in any of them.

  The dev dependency moved to `^2.0.0` in the same change. Widening the peer while building and
  typechecking against 1.x would have declared a compatibility nothing exercised. Against 2.0.0:
  root typecheck clean, build green, 563 tests passing (canvas 232, payments 237, voice 94).

  Applications that extend these bases still declare access on their own subclass, and under
  `@theokit/http@2` an application that forgets is refused instead of served silently.

## 0.11.0

### Minor Changes

- f5621c3: Declare `zod` as a peer dependency on `^4.0.0` instead of bundling `^3.24.0`.

  Both packages export a schema for `@theokit/http`'s `@Body()` — `ttsInputSchema` and
  `artifactSchema` — and `@Body` is typed against zod 4. Bundling zod as a direct dependency put a
  second copy in every consumer's tree, and the published `.d.ts` resolved its bare `import { z } from
'zod'` to that copy, so the schema was typed against a zod the decorator does not accept. The
  pattern each package's own JSDoc prescribes did not compile in any consumer.

  Migrating exposed a behaviour change worth naming on its own: in zod 4, `.default({})` is applied
  after the sub-schema parses, so `plugin-voice` returned `{ stt: {}, tts: {} }` with no provider,
  model or endpoint. That is not a compile error; the fields the package treats as always-present were
  simply missing. The schema now uses `.prefault({})`, which restores the zod 3 semantics.

  Marked minor rather than patch: the peer range no longer accepts zod 3, so a consumer on that line
  must move. Nothing in either package's own API changed.

## 0.10.1

### Patch Changes

- Raise the `@theokit/http` peer floor from `>=1.1.0` to `>=1.1.1`.

  `1.1.0` is deprecated on npm, and for a reason that matters to anyone who has to answer a licence question: it was published carrying `license: MIT` while the repository licenses the code under Apache-2.0. The deprecation message says `Use >=1.1.1`.

  A range whose floor is that version means a consumer resolving to the bottom installs a package whose recorded licence contradicts its source. Nothing breaks at runtime — which is exactly why it would have gone unnoticed until an audit asked.

  Found by the dependency gate's floor check, which installs the bottom of every declared range rather than the version a lockfile happens to hold.

## 0.10.0

### Minor Changes

- ee84154: The voice endpoints as a controller your app extends, instead of two handlers it mounts.

  `VoiceControllerBase` (new, from `@theokit/plugin-voice/server`) declares `POST stt` and `POST tts`
  and carries the half every consumer previously wrote by hand: reading a `multipart/form-data` body
  into the transcription input, and rejecting a request with no audio as a typed `MISSING_AUDIO`
  instead of letting `undefined` reach the provider call.

  It binds no URL prefix and no access decision — both stay yours, which is the point: you vary where
  the verbs are mounted, which provider config backs them, and who may call each one, without editing
  this package. `transcribe` / `synthesise` are protected seams for a per-tenant provider, a usage
  counter, or a cache.

  `handleSttRequest` and `handleTtsRequest` are unchanged and still supported. `@theokit/http` is an
  OPTIONAL peer, loaded only by the new `./server` entry — an app that keeps using the handlers
  installs nothing extra.

## 0.9.0

### Minor Changes

- a76d961: Requires `theokit@0.50.1` or newer, and the README examples now declare a route policy.

  TheoKit 0.50.0 made `.policy()` mandatory on every route: a route without one fails `theokit build`, so that "who may call this" is a decision somebody wrote rather than a default nobody read. The `route()` examples in four of these READMEs predated that and had no policy — a reader who copied one got a build failure from our own documentation.

  Every example now declares its policy and says why it is the right one. For the auth packages that is `public`, because a visitor arrives without a session and signing in is what gives them one; for the payments webhook it is `public` because the gateway holds no session of ours and the signature is the authentication.

  The peer floor moves from `>=0.48.7` to `>=0.50.1` for the same reason it moved in the tests: these packages are built, tested and documented against 0.50.1 and against nothing older. The previous range admitted versions nobody here verifies. If you are on `theokit@0.48.x`, the previous release of these packages still installs.

## 0.8.0

### Minor Changes

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

## 0.7.4

### Patch Changes

- 03b1b5d: Every published export now carries documentation an editor can show. Previously 63.4% of them did (230 of 363), and two packages showed nothing at all: `@theokit/auth-github` and `@theokit/auth-google` measured 0/4, because their module headers began with `@theokit/...`, which TypeScript parses as a tag name and swallows the whole block — text was written and no reader ever got it.

  Seven docblocks were also stranded above another docblock, so they attached to nothing: the symbol they described shipped undocumented and the text shipped invisible. `defineCopilot`'s documentation, including its full usage example, was one of them.

  Type shapes are unchanged. This is visible to consumers because documentation ships in the `.d.ts`.

- bfa7409: The README examples now use the API `theokit@0.48` exports, and every one of them was verified by compiling it rather than by reading it. Ten names they told you to import — `defineConfig`, `defineRoute`, `definePlugin`, `defineAction`, `defineAgentTool`, `defineTheoConfig`, `defineAgentEndpoint`, `streamAgentRun`, `createConversationHistory`, `useAgentStream` — exist in none of that version's 24 export subpaths. Copying the first block of most of these READMEs produced code that did not compile.

  The `auth-google` and `auth-magic-link` wiring examples changed shape rather than names: the auth orchestrator takes Node's `IncomingMessage`/`ServerResponse`, and no handler surface TheoKit exposes today hands you those, so the examples show a Node server and state the gap.

## 0.7.3

### Patch Changes

- 2c0b594: Internal quality: bring every package to `pnpm lint --max-warnings=0` + `prettier`
  compliance (437 pre-existing ESLint errors + workspace formatting). All fixes are
  behavior-preserving — `require-await` resolved by returning `Promise.resolve(...)`
  where a Promise contract is required, `no-unsafe-*` resolved with precise types
  (no `any`), `unbound-method` via property-signatures / arrow wrappers. No public API
  or runtime behavior changes; 665/665 tests remain green.

## 0.7.2

### Patch Changes

- de5df40: Fix boot-time crash under `@theokit/sdk` M31: `voicePlugin()` no longer imports the
  removed `defineTheoPlugin` value from the deprecated `theokit/server` umbrella — it
  returns a `TheoPlugin`-typed object directly (the old wrapper was a pure identity, so
  behavior is unchanged). Server-only handlers (`stt-server`, `tts-server`) moved to
  `src/server/` (internal only — no public subpath change), and the `fetchImpl` seam is
  typed to the exact subset the handlers use (`globalThis.fetch` is still assignable).

## 0.7.1

### Patch Changes

- 342239f: Reduce the cyclomatic complexity of eight audit-flagged functions (CC 16–24) by extracting behavior-preserving named helpers (#182–#189). No behavior change and no public API change — all existing tests stay green. Touched: `github()`'s callback (auth-github); `createInMemoryArtifactStore`, `serializeArtifactForCopy`, and `classifyRemoved` (plugin-canvas); `defineCopilot` (plugin-copilot); the realtime subscription effect (plugin-realtime); and `handleSttRequest`/`handleTtsRequest` (plugin-voice). Six functions now measure CC ≤ 10; `serializeArtifactForCopy` (a 9-kind discriminated-union exhaustive switch) and the in-memory `memList` sit at the idiomatic floor — `lizard`'s TypeScript parser mis-merges their adjacent module helpers into one range, overstating the per-function number, but each real function is ≤ 10.
- db271df: Stop reflecting raw upstream provider error bodies to the client in the STT/TTS handlers (#214). On an upstream error, the body is now logged server-side under a generated correlation id and the client receives a generic `UPSTREAM_ERROR` message carrying the same id (status code unchanged: 5xx→502, 4xx passed through). This prevents leaking provider internals while keeping the failure debuggable via the shared reference id. No public API change.
- 1d8ee52: Guard the STT success-response JSON parse in `<VoiceRecorderBar>` (#217). A `200` response whose body is not valid JSON previously threw an opaque `SyntaxError`; it now surfaces a specific `VoicePluginError` ("Invalid STT response…", with the parse error as `cause`) through the component's `onError` path. No public API change.
- 856c667: Wire `<VoiceRecorderBar>`'s `onError` into the recorder (review finding F-wire-1). The bar previously called `createRecorder()` with no arguments, so the `onError` option (added for in-recording errors) was never passed — a `MediaRecorder` error mid-recording released the stream but left the bar stuck in the recording state with the error lost. The bar now passes `{ onError }` to `createRecorder`; the `recorderFactory` prop is widened to receive the recorder options so injected factories see the same wiring. No breaking change (the zero-arg factory form remains assignable).
- c3f3a35: Recorder errors during recording no longer leak the media stream or get swallowed (#213). When `MediaRecorder` fires an `error` event with no `stop()` pending, `createRecorder` now always calls `releaseStream()` (stopping the mic tracks) and surfaces the typed error through a new optional `onError` callback. Errors during `stop()` still reject the `stop()` promise as before. The `onError` option is additive; the `Recorder` interface is unchanged.
- 243e7a6: Bound the STT/TTS upstream provider calls with a timeout and wire client aborts (#211, #212). `handleSttRequest`/`handleTtsRequest` now accept `timeoutMs` (default 30s) and a `signal` on their options; the per-request timeout is composed with the caller's signal (`AbortSignal.any`) and passed to `fetch`, so a stalled upstream no longer hangs the handler — a timeout or client abort returns `504 UPSTREAM_TIMEOUT` (genuine network errors remain `502 UPSTREAM_NETWORK`). Passing the signal to the real `fetch` also cancels the TTS streamed `audio/mpeg` body when the client disconnects mid-stream. Both options are additive; handler signatures are unchanged.
- 9208043: Unify the TTS voice list into a single source of truth (#215). `options.ts` now exports `VALID_VOICES` and the `tts.voice` schema is `z.enum(VALID_VOICES)` (default `alloy`), so a misconfigured default voice is rejected at construction (and is now a compile-time type error) instead of slipping through `z.string()` and only failing as a 400 on the first request. `tts-server.ts` derives its per-request voice validation from the same `VALID_VOICES`, eliminating the schema/server divergence. The valid set is unchanged (the six OpenAI tts-1 voices).
- 18fc976: Fix a `useTts` playback race where a stale `speak()` whose `audio.play()` resolved late could override a newer `speak()`/`stop()` (#216). Each `speak()` now captures its own `AbortController` and, after every await, checks identity (`abortRef.current !== controller`) rather than only `signal.aborted`. When a call discovers it has been superseded after `play()` resolves, it tears down only its own audio element, blob URL, and event listeners — never the newer call's shared refs or phase. No public API change.
