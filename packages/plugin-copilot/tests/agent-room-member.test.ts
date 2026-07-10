import { describe, expect, it, vi } from 'vitest'
import { AgentRoomMember, COPILOT_CONNECTION_PREFIX } from '../src/agent-room-member.js'
import type { CopilotDescriptor, CopilotRealtimeProvider } from '../src/types.js'

const passthroughSchema = { safeParse: (v: unknown) => ({ success: true as const, data: v }) }

function makeProvider(): CopilotRealtimeProvider & {
  joinRoom: ReturnType<typeof vi.fn>
  leaveRoom: ReturnType<typeof vi.fn>
  broadcast: ReturnType<typeof vi.fn>
  updatePresence: ReturnType<typeof vi.fn>
  getPresence: ReturnType<typeof vi.fn>
  subscribeRoom: ReturnType<typeof vi.fn>
} {
  return {
    joinRoom: vi.fn().mockResolvedValue(undefined),
    leaveRoom: vi.fn().mockResolvedValue(undefined),
    broadcast: vi.fn().mockResolvedValue(undefined),
    updatePresence: vi.fn().mockResolvedValue(undefined),
    getPresence: vi.fn().mockResolvedValue({}),
    subscribeRoom: vi.fn().mockReturnValue(() => {
      /* intentionally empty — stub unsubscribe */
    }),
  }
}

const copilot: CopilotDescriptor = {
  id: 'test',
  room: { id: 'room', presence: passthroughSchema, broadcast: passthroughSchema },
  agent: { name: 'GPT', model: 'x' },
  identity: { name: 'AI', color: '#000' },
  triggers: [{ on: 'broadcast:q', action: 'respond' }],
}

describe('AgentRoomMember', () => {
  it('computes connectionId with copilot: prefix', () => {
    const provider = makeProvider()
    const m = new AgentRoomMember(copilot, provider)
    expect(m.connectionId).toBe(`${COPILOT_CONNECTION_PREFIX}test`)
  })

  it('join calls provider.joinRoom with identity presence', async () => {
    const provider = makeProvider()
    const m = new AgentRoomMember(copilot, provider)
    await m.join()
    expect(provider.joinRoom).toHaveBeenCalledTimes(1)
    const args = provider.joinRoom.mock.calls[0]!
    expect(args[0]).toBe('room')
    expect(args[1]).toEqual({ connectionId: 'copilot:test' })
    expect(args[2]).toMatchObject({ name: 'AI', typing: false, isCopilot: true, color: '#000' })
    expect(m.isJoined).toBe(true)
  })

  it('join is idempotent', async () => {
    const provider = makeProvider()
    const m = new AgentRoomMember(copilot, provider)
    await m.join()
    await m.join()
    expect(provider.joinRoom).toHaveBeenCalledTimes(1)
  })

  it('leave calls provider.leaveRoom', async () => {
    const provider = makeProvider()
    const m = new AgentRoomMember(copilot, provider)
    await m.join()
    await m.leave()
    expect(provider.leaveRoom).toHaveBeenCalledWith('room', 'copilot:test')
    expect(m.isJoined).toBe(false)
  })

  it('leave is idempotent (no-op when not joined)', async () => {
    const provider = makeProvider()
    const m = new AgentRoomMember(copilot, provider)
    await m.leave()
    expect(provider.leaveRoom).not.toHaveBeenCalled()
  })

  it('setTyping updates presence', async () => {
    const provider = makeProvider()
    const m = new AgentRoomMember(copilot, provider)
    await m.join()
    await m.setTyping(true, 0.5)
    expect(provider.updatePresence).toHaveBeenCalledWith('room', 'copilot:test', {
      typing: true,
      progress: 0.5,
    })
  })

  it('setTyping is no-op when not joined', async () => {
    const provider = makeProvider()
    const m = new AgentRoomMember(copilot, provider)
    await m.setTyping(true)
    expect(provider.updatePresence).not.toHaveBeenCalled()
  })

  it('broadcastMessage emits message event with role + text + copilotId', async () => {
    const provider = makeProvider()
    const m = new AgentRoomMember(copilot, provider)
    await m.join()
    await m.broadcastMessage('hello world', { extra: 1 })
    expect(provider.broadcast).toHaveBeenCalledWith('room', 'copilot:test', 'message', {
      role: 'assistant',
      text: 'hello world',
      copilotId: 'test',
      extra: 1,
    })
  })

  it('broadcastEvent emits custom event with copilotId injected', async () => {
    const provider = makeProvider()
    const m = new AgentRoomMember(copilot, provider)
    await m.join()
    await m.broadcastEvent('artifact', { kind: 'mermaid', source: 'graph LR; A-->B' })
    expect(provider.broadcast).toHaveBeenCalledWith('room', 'copilot:test', 'artifact', {
      kind: 'mermaid',
      source: 'graph LR; A-->B',
      copilotId: 'test',
    })
  })
})
