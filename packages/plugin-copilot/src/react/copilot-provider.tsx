/**
 * @theokit/plugin-copilot/react — CopilotProvider (P#11).
 *
 * Per ADR D5 — React Context wrapper feeding {@link CopilotContext}. Wires
 * to a `CopilotRealtimeProvider` (structural mirror of P#9 provider). Tracks
 * messages + presence + typing + usage state.
 *
 * @public
 */

import * as React from 'react'
import type { CopilotFrame, CopilotRealtimeProvider } from '../types.js'
import {
  CopilotContext,
  type CopilotContextValue,
  type CopilotMessage,
  type CopilotPresenceEntry,
  isCopilotConnectionId,
} from './copilot-context.js'

/**
 * Props for {@link CopilotProvider}.
 *
 * @public
 */
export interface CopilotProviderProps {
  /** Copilot id (matches defineCopilot id). */
  copilotId: string
  /** Room id (matches P#9 RoomDescriptor id the copilot is bound to). */
  roomId: string
  /** P#9 RealtimeProvider — same instance used server-side. */
  provider: CopilotRealtimeProvider
  /** Local user connection id (for sendBroadcast attribution). */
  userConnectionId: string
  /** Max retained messages (default 200). */
  messageCap?: number
  /** Optional usage poll fn (theo-ui usage-meter integration). */
  usage?: () => { dailyUsedUsd: number; monthlyUsedUsd: number } | undefined
  /** Children rendered inside the context. */
  readonly children?: React.ReactNode
}

/**
 * React Context provider wiring a copilot subscription to room frames.
 *
 * @public
 */
export function CopilotProvider(props: CopilotProviderProps): React.ReactElement {
  const { copilotId, roomId, provider, userConnectionId, messageCap, usage, children } = props
  const cap = messageCap ?? 200
  const [messages, setMessages] = React.useState<readonly CopilotMessage[]>([])
  const [presence, setPresence] = React.useState<Record<string, CopilotPresenceEntry>>({})
  const [lastError, setLastError] = React.useState<CopilotContextValue['lastError']>()
  const messageIdRef = React.useRef(0)

  React.useEffect(() => {
    let cancelled = false
    const unsubscribe = provider.subscribeRoom(roomId, (frame: CopilotFrame) => {
      if (cancelled) return
      handleFrame(frame, messageIdRef, cap, setMessages, setPresence, setLastError)
    })
    // Initial presence snapshot.
    void provider.getPresence(roomId).then((snap) => {
      if (cancelled) return
      const next: Record<string, CopilotPresenceEntry> = {}
      for (const [connId, p] of Object.entries(snap)) {
        next[connId] = presenceFromMap(connId, p)
      }
      setPresence(next)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [provider, roomId, cap])

  const sendBroadcast = React.useCallback(
    (event: string, payload: Record<string, unknown>): void => {
      void provider.broadcast(roomId, userConnectionId, event, payload)
    },
    [provider, roomId, userConnectionId],
  )

  const isAnyCopilotTyping = React.useMemo(
    () => Object.values(presence).some((p) => p.isCopilot && p.typing === true),
    [presence],
  )

  const currentUsage = React.useMemo(() => usage?.(), [usage])

  const value = React.useMemo<CopilotContextValue>(
    () => ({
      copilotId,
      roomId,
      messages,
      presence,
      isAnyCopilotTyping,
      sendBroadcast,
      // So a component can tell the local user apart from the room. This provider already had
      // the id — it broadcasts with it — and simply never published it (#114).
      userConnectionId,
      ...(currentUsage !== undefined ? { usage: currentUsage } : {}),
      ...(lastError !== undefined ? { lastError } : {}),
    }),
    [
      copilotId,
      roomId,
      messages,
      presence,
      isAnyCopilotTyping,
      sendBroadcast,
      userConnectionId,
      currentUsage,
      lastError,
    ],
  )

  return React.createElement(CopilotContext.Provider, { value }, children)
}

function presenceFromMap(connectionId: string, p: Record<string, unknown>): CopilotPresenceEntry {
  const isCopilot = isCopilotConnectionId(connectionId) || p.isCopilot === true
  const entry: CopilotPresenceEntry = {
    connectionId,
    isCopilot,
    ...(typeof p.name === 'string' ? { name: p.name } : {}),
    ...(typeof p.avatar === 'string' ? { avatar: p.avatar } : {}),
    ...(typeof p.color === 'string' ? { color: p.color } : {}),
    ...(typeof p.typing === 'boolean' ? { typing: p.typing } : {}),
    ...(typeof p.progress === 'number' ? { progress: p.progress } : {}),
  }
  return entry
}

function handleFrame(
  frame: CopilotFrame,
  messageIdRef: React.MutableRefObject<number>,
  cap: number,
  setMessages: React.Dispatch<React.SetStateAction<readonly CopilotMessage[]>>,
  setPresence: React.Dispatch<React.SetStateAction<Record<string, CopilotPresenceEntry>>>,
  setLastError: React.Dispatch<React.SetStateAction<CopilotContextValue['lastError']>>,
): void {
  switch (frame.type) {
    case 'joined':
      setPresence((prev) => ({
        ...prev,
        [frame.connectionId]: presenceFromMap(frame.connectionId, frame.presence),
      }))
      return
    case 'left':
      setPresence((prev) => {
        const next = { ...prev }
        delete next[frame.connectionId]
        return next
      })
      return
    case 'presence-changed':
      setPresence((prev) => ({
        ...prev,
        [frame.connectionId]: presenceFromMap(frame.connectionId, frame.presence),
      }))
      return
    case 'broadcast': {
      const payload = frame.payload
      const isCopilot = isCopilotConnectionId(frame.connectionId)
      // Capture canonical errors.
      if (frame.event === 'agent-error' || frame.event === 'budget-exceeded') {
        setLastError({
          code: typeof payload?.code === 'string' ? payload.code : frame.event,
          message:
            typeof payload?.message === 'string' ? payload.message : `Copilot ${frame.event}`,
        })
        return
      }
      // Capture chat messages.
      if (frame.event === 'message' || frame.event === 'question') {
        const text = typeof payload?.text === 'string' ? payload.text : ''
        if (text.length === 0) return
        messageIdRef.current++
        const msg: CopilotMessage = {
          id: `msg-${messageIdRef.current}`,
          role: isCopilot ? 'assistant' : 'user',
          text,
          senderId: frame.connectionId,
          senderName: typeof payload?.senderName === 'string' ? payload.senderName : undefined,
          copilotId: typeof payload?.copilotId === 'string' ? payload.copilotId : undefined,
          ts: Date.now(),
        }
        setMessages((prev) => {
          const next = prev.length >= cap ? prev.slice(prev.length - cap + 1) : [...prev]
          next.push(msg)
          return next
        })
      }
    }
  }
}
