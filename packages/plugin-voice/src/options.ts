// Configuration schema for `voicePlugin()`.
//
// EC-6 absorbed: `validateVoiceOptions()` runs synchronously at plugin
// construction time. Missing or empty API key throws
// `VoicePluginConfigError` immediately — the app crashes on boot rather
// than the first request hitting a 500.
//
// Provider selection (D11):
// - `stt.provider`: "openai" (default) | "groq"
// - `tts.provider`: "openai" (default) — Groq does not offer TTS as of
// 2026-05, so this stays single-provider for now.
//
// API key resolution order:
// 1. Explicit `stt.apiKey` / `tts.apiKey` in opts (overrides env)
// 2. `process.env[stt.envVar]` (defaults: OPENAI_API_KEY / GROQ_API_KEY)
//
// Endpoint paths are configurable so consumers can mount the plugin
// behind a custom prefix (e.g. `/v1/voice/stt`) without forking.

import { z } from 'zod'
import { VoicePluginConfigError } from './errors.js'

/**
 * The OpenAI tts-1 closed voice enum — the SINGLE source of truth (#215).
 * Imported by `tts-server.ts` (runtime per-request validation) so the schema
 * default and the server never diverge. `talk-options.tsx` mirrors this list
 * for its UI dropdown (kept in sync per its own docstring).
 */
export const VALID_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const

export type VoiceName = (typeof VALID_VOICES)[number]

const sttSchema = z.object({
  provider: z.enum(['openai', 'groq']).default('openai'),
  apiKey: z.string().min(1).optional(),
  envVar: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  endpoint: z.string().min(1).regex(/^\//, 'endpoint must start with /').default('/api/voice/stt'),
})

const ttsSchema = z.object({
  provider: z.literal('openai').default('openai'),
  apiKey: z.string().min(1).optional(),
  envVar: z.string().min(1).optional(),
  model: z.string().min(1).default('tts-1'),
  voice: z.enum(VALID_VOICES).default('alloy'),
  endpoint: z.string().min(1).regex(/^\//, 'endpoint must start with /').default('/api/voice/tts'),
})

export const voiceOptionsSchema = z.object({
  stt: sttSchema.default({}),
  tts: ttsSchema.default({}),
})

/** What a consumer passes to `voicePlugin()` — the input side of the schema, before defaults. */
export type VoiceOptions = z.input<typeof voiceOptionsSchema>
/**
 * The configuration after parsing: defaults applied, providers chosen, endpoints settled.
 *
 * Distinct from {@link VoiceOptions} on purpose — everything optional on the way in is present here,
 * so downstream code never re-derives a default and never disagrees with the one already applied.
 */
export type ResolvedVoiceOptions = z.output<typeof voiceOptionsSchema>

const DEFAULT_STT_ENV_VAR: Record<'openai' | 'groq', string> = {
  openai: 'OPENAI_API_KEY',
  groq: 'GROQ_API_KEY',
}

const DEFAULT_TTS_ENV_VAR: Record<'openai', string> = {
  openai: 'OPENAI_API_KEY',
}

/**
 * Internal shape used by the hook layer — keys are guaranteed present
 * (validateVoiceOptions throws if any provider is missing credentials).
 */
export interface VoiceConfig {
  stt: {
    provider: 'openai' | 'groq'
    apiKey: string
    model: string
    endpoint: string
  }
  tts: {
    provider: 'openai'
    apiKey: string
    model: string
    voice: string
    endpoint: string
  }
}

export function validateVoiceOptions(options: VoiceOptions = {}): VoiceConfig {
  const parsed = voiceOptionsSchema.parse(options)
  const stt = resolveStt(parsed.stt)
  const tts = resolveTts(parsed.tts)
  return { stt, tts }
}

function resolveStt(stt: ResolvedVoiceOptions['stt']): VoiceConfig['stt'] {
  const envVar = stt.envVar ?? DEFAULT_STT_ENV_VAR[stt.provider]
  const apiKey = stt.apiKey ?? process.env[envVar]
  if (apiKey === undefined || apiKey.length === 0) {
    throw new VoicePluginConfigError(
      `Missing ${envVar} for @theokit/plugin-voice STT (provider=${stt.provider}). Set the env var or pass stt.apiKey explicitly. See @theokit/plugin-voice README → Configuration.`,
    )
  }
  return {
    provider: stt.provider,
    apiKey,
    model: stt.model ?? defaultSttModel(stt.provider),
    endpoint: stt.endpoint,
  }
}

function resolveTts(tts: ResolvedVoiceOptions['tts']): VoiceConfig['tts'] {
  const envVar = tts.envVar ?? DEFAULT_TTS_ENV_VAR[tts.provider]
  const apiKey = tts.apiKey ?? process.env[envVar]
  if (apiKey === undefined || apiKey.length === 0) {
    throw new VoicePluginConfigError(
      `Missing ${envVar} for @theokit/plugin-voice TTS (provider=${tts.provider}). Set the env var or pass tts.apiKey explicitly. See @theokit/plugin-voice README → Configuration.`,
    )
  }
  return {
    provider: tts.provider,
    apiKey,
    model: tts.model,
    voice: tts.voice,
    endpoint: tts.endpoint,
  }
}

function defaultSttModel(provider: 'openai' | 'groq'): string {
  return provider === 'openai' ? 'whisper-1' : 'whisper-large-v3'
}
