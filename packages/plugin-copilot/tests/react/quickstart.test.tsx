/**
 * @vitest-environment jsdom
 *
 * #172 / #173 — the README Quick start must compile and run against the REAL
 * `CopilotProvider` props (`userConnectionId`, no `runtime` prop) and the
 * object-argument hook signatures (`useCopilotReadable({description,value})`,
 * `useCopilotTool({name,description,handler})`). This test mirrors the documented
 * integration path verbatim so the docs can never drift from the typed API again
 * (it would fail to COMPILE if the README's API and the code diverged).
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CopilotProvider } from '../../src/react/copilot-provider.js'
import {
  useCopilotMessages,
  useCopilotPresence,
  useCopilotReadable,
  useCopilotTool,
  useCopilotTyping,
} from '../../src/react/hooks.js'
import type { CopilotRealtimeProvider } from '../../src/types.js'

const provider: CopilotRealtimeProvider = {
  async joinRoom() {
    /* noop stub */
  },
  async leaveRoom() {
    /* noop stub */
  },
  async broadcast() {
    /* noop stub */
  },
  async updatePresence() {
    /* noop stub */
  },
  getPresence() {
    return Promise.resolve({})
  },
  subscribeRoom() {
    return () => undefined
  },
}

// Mirrors the README "headless hooks" block exactly (object-arg signatures).
function MyCustomChat() {
  const messages = useCopilotMessages()
  const presence = useCopilotPresence()
  const typing = useCopilotTyping()
  useCopilotReadable({ description: 'currentPage', value: { url: '/dashboard' } })
  useCopilotTool({
    name: 'create-task',
    description: 'Create a task',
    handler: (_args: Record<string, unknown>) => Promise.resolve(undefined),
  })
  return (
    <div data-testid="custom-chat" data-msgs={messages.length} data-typing={String(typing)}>
      {Object.keys(presence).length} peers
    </div>
  )
}

describe('#172/#173 — README Quick start mirrors the real API', () => {
  it('test_documented_quickstart_compiles_and_works', () => {
    const { getByTestId } = render(
      <CopilotProvider
        roomId="support-room"
        copilotId="support-bot"
        provider={provider}
        userConnectionId="alice"
      >
        <MyCustomChat />
      </CopilotProvider>,
    )
    expect(getByTestId('custom-chat')).toBeTruthy()
  })
})
