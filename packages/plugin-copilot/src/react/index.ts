/**
 * @theokit/plugin-copilot/react — public barrel (P#11 React sub-path).
 *
 * @public
 */

export {
  CopilotContext,
  type CopilotContextValue,
  type CopilotMessage,
  type CopilotPresenceEntry,
  isCopilotConnectionId,
} from './copilot-context.js'

export { CopilotProvider, type CopilotProviderProps } from './copilot-provider.js'

export {
  useCopilot,
  useCopilotMessages,
  useCopilotPresence,
  useCopilotReadable,
  useCopilotTool,
  useCopilotTyping,
} from './hooks.js'

export { CopilotChat, type CopilotChatProps } from './CopilotChat.js'
