/**
 * @theokit/plugin-copilot — public barrel (P#11 v0.1.0).
 *
 * Per ADRs D1-D8 (blueprint p11-plugin-copilot SHIPPABLE 100/100).
 *
 * @public
 */

export {
  type CopilotAgentConfig,
  type CopilotAgentLike,
  type CopilotBudgetConfig,
  type CopilotCanvasConfig,
  CopilotConfigError,
  type CopilotDescriptor,
  type CopilotDispatcher,
  CopilotError,
  type CopilotFrame,
  type CopilotIdentity,
  type CopilotRateLimitConfig,
  type CopilotRealtimeProvider,
  type CopilotRoomBinding,
  type CopilotTrigger,
  CopilotTriggerError,
  type CopilotVoiceConfig,
} from './types.js'

export { defineCopilot, type DefineCopilotOptions } from './define-copilot.js'

export { defineCopilotRealtimeProvider } from './provider.js'

export { AgentRoomMember, COPILOT_CONNECTION_PREFIX } from './agent-room-member.js'

export { CopilotRuntime, type CopilotRuntimeOptions } from './internal/runtime.js'

// The TheoKit plugin surface (#42 item 3, #62 scope 3) — `ctx.copilot`.
export { copilot, COPILOT_DECORATION_KEY } from './plugin.js'
export type { CopilotPlugin, CopilotRequestSurface } from './plugin.js'
// Re-exported with `export type {`, not an inline `type` modifier: the manifest validator
// reads `type TheoApp` as a local declaration of a framework-owned type (#42), and the
// two forms are indistinguishable to it. `plugin-payments` uses this form for the same
// reason.
export type { TheoApp, TheoPlugin } from './plugin.js'

// Cost settlement, exported so a consumer can price an invocation the same way (#61).
export { settleCost, splitModelId, type SettledCost } from './internal/cost.js'

export { TriggerEvaluator, type TriggerMatch } from './internal/trigger-evaluator.js'

export { BudgetBridge } from './internal/budget-bridge.js'

export { ensureVoicePeer } from './internal/voice-bridge.js'

export { ensureCanvasPeer } from './internal/canvas-bridge.js'
