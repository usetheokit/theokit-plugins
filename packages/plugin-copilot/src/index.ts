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

export { TriggerEvaluator, type TriggerMatch } from './internal/trigger-evaluator.js'

export { BudgetBridge } from './internal/budget-bridge.js'

export { ensureVoicePeer } from './internal/voice-bridge.js'

export { ensureCanvasPeer } from './internal/canvas-bridge.js'
