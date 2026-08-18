/**
 * P#11 T4.2 — REAL LLM end-to-end.
 *
 * Env-gated by OPENROUTER_API_KEY. Without it the suite emits honest SKIP
 * (per `.claude/rules/real-llm-validation.md`). When the key is set, this
 * boots the SDK 1.6.0 `Agent.streamObject` against `openrouter/openai/
 * gpt-4o-mini`, registers a single copilot in an in-process Room, has a
 * "user" broadcast a question, and asserts that the copilot's broadcasted
 * message contains a non-empty natural-language response.
 *
 * NOTE: this is the only test in the package that hits the network. All
 * other tests rely on deterministic mocked agents (T4.1 fixture) — keeps CI
 * fast and zero-cost without OPENROUTER_API_KEY.
 *
 * Cost ceiling: ~$0.001 USD per run (1 short question + short answer; gpt-4o-mini).
 */
import { describe, expect, it } from 'vitest'
import { defineCopilot } from '../../src/define-copilot.js'
import { CopilotRuntime } from '../../src/internal/runtime.js'
import type { CopilotAgentLike, CopilotFrame, CopilotRealtimeProvider } from '../../src/types.js'

/**
 * Gated on E2E_LIVE as well as on the key, added 2026-08-17 alongside `e2e/`.
 *
 * The key alone was not enough of a gate. `pnpm test` runs on every push and
 * reaches this file, so anyone with OPENROUTER_API_KEY exported — which is
 * everyone who has ever run this probe once — paid for an LLM round trip on
 * every unrelated test run, without asking for it. Costing money must be opted
 * into, not inherited from a shell that happens to have a key in it.
 *
 * It stays in the package rather than moving to `e2e/` because it needs an
 * in-memory CopilotRealtimeProvider fixture that is not exported. The gate is
 * the same one `e2e/` uses, so `E2E_LIVE=1` opts into both together.
 */
const LIVE_OPTED_IN = process.env.E2E_LIVE !== undefined && process.env.E2E_LIVE !== '0'

const HAS_OPENROUTER =
  LIVE_OPTED_IN &&
  typeof process.env.OPENROUTER_API_KEY === 'string' &&
  process.env.OPENROUTER_API_KEY.length > 0

const passthroughSchema = {
  safeParse: (v: unknown) => ({ success: true as const, data: v }),
}

interface InMemoryProvider extends CopilotRealtimeProvider {
  emit(roomId: string, frame: CopilotFrame): void
  broadcasts: {
    roomId: string
    connectionId: string
    event: string
    payload: Record<string, unknown>
  }[]
}

function makeProvider(): InMemoryProvider {
  const subs = new Map<string, Set<(f: CopilotFrame) => void>>()
  const presences = new Map<string, Map<string, Record<string, unknown>>>()
  const provider: InMemoryProvider = {
    broadcasts: [],
    joinRoom(roomId, conn, initialPresence) {
      const room = presences.get(roomId) ?? new Map<string, Record<string, unknown>>()
      room.set(conn.connectionId, initialPresence ?? {})
      presences.set(roomId, room)
      provider.emit(roomId, {
        type: 'joined',
        connectionId: conn.connectionId,
        presence: initialPresence ?? {},
      })
      return Promise.resolve()
    },
    leaveRoom(roomId, connectionId) {
      presences.get(roomId)?.delete(connectionId)
      return Promise.resolve()
    },
    broadcast(roomId, connectionId, event, payload) {
      provider.broadcasts.push({ roomId, connectionId, event, payload })
      provider.emit(roomId, { type: 'broadcast', connectionId, event, payload })
      return Promise.resolve()
    },
    updatePresence(roomId, connectionId, patch) {
      const room = presences.get(roomId)
      const cur = room?.get(connectionId) ?? {}
      const merged = { ...cur, ...patch }
      room?.set(connectionId, merged)
      provider.emit(roomId, { type: 'presence-changed', connectionId, presence: merged })
      return Promise.resolve()
    },
    getPresence(roomId) {
      const out: Record<string, Record<string, unknown>> = {}
      const room = presences.get(roomId)
      if (room === undefined) return Promise.resolve(out)
      for (const [k, v] of room) out[k] = v
      return Promise.resolve(out)
    },
    subscribeRoom(roomId, listener) {
      const set = subs.get(roomId) ?? new Set()
      set.add(listener)
      subs.set(roomId, set)
      return () => set.delete(listener)
    },
    emit(roomId, frame) {
      const set = subs.get(roomId)
      if (set === undefined) return
      for (const cb of set) cb(frame)
    },
  }
  return provider
}

describe.skipIf(!HAS_OPENROUTER)(
  'P#11 T4.2 — real LLM end-to-end (OPENROUTER_API_KEY required)',
  () => {
    it('copilot answers a real question via Agent.streamObject (openrouter/openai/gpt-4o-mini)', async () => {
      // Dynamic import to avoid pulling SDK into the bundle path when key absent.
      const { Agent } = await import('@theokit/sdk')

      // Adapter: bridges CopilotAgentLike (instance-shaped streamObject) to
      // SDK 1.6.0 Agent.prompt (static one-shot). We use prompt instead of
      // streamObject because prompt is the canonical "ask + answer" path and
      // doesn't require synthetic tool_use forcing for JSON output. The
      // CopilotRuntime expects a partial → complete stream; we synthesize that
      // shape from the single Agent.prompt result.
      const sdkAgent: CopilotAgentLike = {
        async *streamObject(opts: {
          prompt: string
          model: string | { id: string }
          systemPrompt?: string
        }) {
          const sysPrompt = (opts.systemPrompt ?? '').trim()
          const userPrompt = opts.prompt
          const fullPrompt = sysPrompt.length > 0 ? `${sysPrompt}\n\n${userPrompt}` : userPrompt
          // Normalize model to {id: string} shape — string form is ambiguous to
          // the SDK when provider is pinned (it can fall back to the global
          // configured default model id, e.g. claude-sonnet-4-6, instead of the
          // string we passed). The {id} object form is unambiguous.
          const modelSel = typeof opts.model === 'string' ? { id: opts.model } : opts.model
          const result = await Agent.prompt(fullPrompt, {
            model: modelSel,
            apiKey: process.env.OPENROUTER_API_KEY ?? '',
            local: { settingSources: [] },
            providers: {
              routes: [{ capability: 'chat', provider: 'openrouter' }],
              fallback: ['openrouter'],
            },
          })
          if (result.status !== 'finished') {
            throw new Error(
              `Agent.prompt status=${result.status}: ${JSON.stringify(
                (result as { error?: unknown }).error,
              )}`,
            )
          }
          const text = typeof result.result === 'string' ? result.result : ''
          yield { type: 'partial', partial: { text } as never, attempt: 0 }
          yield { type: 'complete', object: { text } as never }
        },
      }

      const copilot = defineCopilot({
        id: 'haiku-bot',
        room: {
          id: 'real-llm-room',
          presence: passthroughSchema,
          broadcast: passthroughSchema,
        },
        agent: {
          name: 'HaikuBot',
          // When provider is pinned to "openrouter" via providers.routes, the
          // model id is forwarded raw to OpenRouter (no "openrouter/" prefix).
          model: 'openai/gpt-4o-mini',
          systemPrompt: 'You are HaikuBot. Always reply with a single 3-line haiku — nothing else.',
        },
        identity: { name: 'Haiku Bot', color: '#7c3aed' },
        triggers: [{ on: 'broadcast:ask', action: 'respond' }],
        // Cap real-LLM cost defensively — abort if estimate exceeds $0.05.
        budget: { perRoom: { perRequestUsd: 0.05, dailyUsd: 0.5 } },
      })

      const provider = makeProvider()
      const responses: string[] = []
      const rt = new CopilotRuntime({
        provider,
        agent: sdkAgent,
        copilots: [copilot],
        estimatedCostPerInvocationUsd: 0.001,
        onResponse: (id, room, text) => {
          responses.push(text)
        },
      })

      await rt.activate('haiku-bot')

      await provider.broadcast('real-llm-room', 'alice', 'ask', {
        text: 'Write me a haiku about TypeScript.',
      })

      // Real LLM round-trip needs more headroom — wait up to 60s.
      const deadline = Date.now() + 60_000
      while (responses.length === 0 && Date.now() < deadline) {
        // Bail early when copilot broadcast a typed error frame (agent-error / budget-exceeded).
        const errFrame = provider.broadcasts.find(
          (b) =>
            b.connectionId === 'copilot:haiku-bot' &&
            (b.event === 'agent-error' || b.event === 'budget-exceeded'),
        )
        if (errFrame !== undefined) {
          throw new Error(
            `Copilot emitted typed error frame "${errFrame.event}": ${JSON.stringify(errFrame.payload)}`,
          )
        }
        await new Promise((r) => setTimeout(r, 200))
      }

      expect(responses).toHaveLength(1)
      expect(responses[0]).toMatch(/\S/) // non-whitespace content
      expect((responses[0] ?? '').length).toBeGreaterThan(10)

      const msg = provider.broadcasts.find(
        (b) => b.connectionId === 'copilot:haiku-bot' && b.event === 'message',
      )
      expect(msg).toBeDefined()
      const msgText = msg?.payload.text
      expect(typeof msgText).toBe('string')
      expect((typeof msgText === 'string' ? msgText : '').length).toBeGreaterThan(10)

      await rt.unregisterCopilot('haiku-bot')
    }, 90_000)
  },
)

describe.skipIf(HAS_OPENROUTER)('P#11 T4.2 — real LLM SKIPPED (no OPENROUTER_API_KEY)', () => {
  it('honest SKIP — set OPENROUTER_API_KEY to enable real-LLM validation', () => {
    expect(HAS_OPENROUTER).toBe(false)
  })
})
