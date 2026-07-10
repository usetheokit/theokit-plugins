/**
 * In-process pub/sub bus that bridges agent-tool emits (publish_artifact)
 * to SSE consumers (the agent endpoint that yields tool_result events).
 *
 * The bus is intentionally a closed module — no global singleton, no
 * top-level state — so consumers can run multiple isolated buses in
 * tests. Apps should treat it as a **module-scope singleton** (see
 * README warnings).
 *
 * EC-2 (canvas-ecosystem-refactor): handler isolation — a handler that
 * throws does NOT prevent the remaining handlers from receiving the
 * emit. Failures are logged to `console.error` and swallowed.
 *
 * EC-10 (DOCUMENT): module-scope only. `createArtifactBus()` allocates
 * fresh state; do NOT call it per-request.
 *
 * EC-11 (DOCUMENT): process-local. In multi-instance deployments use a
 * future `createRedisArtifactBus()` adapter.
 */

import type { Artifact } from '../schema.js'

export type ArtifactBusHandler = (artifact: Artifact) => void

export interface ArtifactBus {
  /**
   * Deliver `artifact` synchronously to every subscriber registered
   * for `conversationId`. Each handler is wrapped in `try/catch` so
   * one bad handler cannot starve the others.
   */
  emit(conversationId: string, artifact: Artifact): void
  /**
   * Register a handler. Returns an `unsubscribe` function that, when
   * called, removes only the specific handler instance. Multiple
   * subscriptions for the same conversation are supported.
   */
  subscribe(conversationId: string, handler: ArtifactBusHandler): () => void
  /** Snapshot of conversation ids with at least one subscriber. */
  listConversations(): string[]
  /** Drop all subscriptions. Useful on server shutdown / between tests. */
  dispose(): void
}

export function createArtifactBus(): ArtifactBus {
  const subscribers = new Map<string, Set<ArtifactBusHandler>>()

  return {
    emit(conversationId, artifact) {
      const handlers = subscribers.get(conversationId)
      if (handlers === undefined) return
      for (const handler of handlers) {
        try {
          handler(artifact)
        } catch (err) {
          // EC-2: never let one handler throw out of the dispatch loop.
          // Use stderr-friendly logging without taking a logger dep.
           
          console.error(
            `[plugin-canvas/artifact-bus] handler for conversation "${conversationId}" threw:`,
            err,
          )
        }
      }
    },
    subscribe(conversationId, handler) {
      let handlers = subscribers.get(conversationId)
      if (handlers === undefined) {
        handlers = new Set()
        subscribers.set(conversationId, handlers)
      }
      handlers.add(handler)
      return () => {
        const current = subscribers.get(conversationId)
        if (current === undefined) return
        current.delete(handler)
        if (current.size === 0) subscribers.delete(conversationId)
      }
    },
    listConversations() {
      return [...subscribers.keys()]
    },
    dispose() {
      subscribers.clear()
    },
  }
}
