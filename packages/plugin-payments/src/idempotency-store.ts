/**
 * @theokit/plugin-payments — idempotency store.
 *
 * Per plan p6-plugin-payments v1.0 § Phase 2 / T2.3.
 * Blueprint ADR D2: canonical Next.js example DOES NOT implement idempotency
 * (gap); Stripe retries failed webhooks ~3 days → real double-processing risk.
 *
 * Plugin ships:
 *   - `IdempotencyStore` interface (consumer-implementable)
 *   - `createMemoryStore()` — dev/test default (single-process; not multi-replica safe)
 *   - `createOrmStore(repo)` — production-grade via @theokit/orm Repository
 *     (atomic UNIQUE event_id INSERT detects duplicates)
 */

/**
 * Contract for idempotency storage. Consumer apps may provide their own
 * implementation backed by Redis, Postgres advisory locks, etc.
 */
export interface IdempotencyStore {
  /**
   * Atomic claim: mark a Stripe webhook event as processed.
   *
   * @returns `true` if the event was new (consumer should process it);
   *          `false` if the event was already processed (consumer should
   *          return 200 without re-running the handler).
   */
  markProcessed(eventId: string): Promise<boolean>

  /**
   * Release a claim made by `markProcessed` when downstream processing FAILED,
   * so a later delivery (Stripe retry) can re-claim and re-run the handler.
   *
   * This is what makes the dispatcher exactly-once on success AND
   * retry-on-failure (#167): the event is claimed before dispatch and released
   * if the handler throws. Releasing an unknown/never-claimed id is a no-op.
   */
  release(eventId: string): Promise<void>
}

/**
 * In-memory idempotency store. Suitable for dev and tests; NOT multi-replica
 * safe (each process has its own Set; in a multi-process deploy, the same
 * event may slip past as new on a different replica).
 *
 * Uses an internal single-flight Promise map so concurrent calls for the
 * same event ID resolve consistently — exactly one returns `true`.
 */
export function createMemoryStore(): IdempotencyStore {
  const seen = new Set<string>()
  // In-flight claims per event ID so concurrent callers race deterministically.
  const inflight = new Map<string, Promise<boolean>>()

  return {
    async markProcessed(eventId: string): Promise<boolean> {
      const existing = inflight.get(eventId)
      if (existing) {
        // Wait for the in-flight call; we lost the race → always false here.
        await existing
        return false
      }
      const promise: Promise<boolean> = Promise.resolve().then(() => {
        if (seen.has(eventId)) return false
        seen.add(eventId)
        return true
      })
      inflight.set(eventId, promise)
      try {
        return await promise
      } finally {
        inflight.delete(eventId)
      }
    },

    release(eventId: string): Promise<void> {
      // Un-claim so a retry can re-run. No-op if it was never claimed.
      seen.delete(eventId)
      inflight.delete(eventId)
      return Promise.resolve()
    },
  }
}

/**
 * Minimal Repository surface needed by `createOrmStore`. Structural so the
 * plugin doesn't take a peerDep on a specific @theokit/orm version's exported
 * Repository<T> generic.
 *
 * Consumer provides an object that wraps a drizzle Repository configured for
 * the `webhook_events` table with `event_id` UNIQUE.
 */
export interface IdempotencyRepository {
  /**
   * Attempt to insert a new webhook event row. Returns `true` if inserted;
   * `false` if the event_id already exists (UNIQUE constraint violation
   * caught at adapter level).
   */
  insertNew(eventId: string): Promise<boolean>

  /**
   * Delete a previously-inserted event row, releasing the claim so a retry can
   * re-insert and re-run after a handler failure (#167). No-op if absent.
   */
  delete(eventId: string): Promise<void>
}

/**
 * Production-grade idempotency store backed by an @theokit/orm Repository.
 *
 * Schema recommendation for consumers (see README for migration SQL):
 *
 * ```sql
 * CREATE TABLE webhook_events (
 *   event_id TEXT PRIMARY KEY,
 *   processed_at TIMESTAMP NOT NULL DEFAULT NOW()
 * );
 * ```
 *
 * The atomic INSERT + UNIQUE constraint guarantees no double-processing
 * across multiple replicas (the DB is the source of truth).
 */
export function createOrmStore(repo: IdempotencyRepository): IdempotencyStore {
  return {
    async markProcessed(eventId: string): Promise<boolean> {
      return await repo.insertNew(eventId)
    },
    async release(eventId: string): Promise<void> {
      await repo.delete(eventId)
    },
  }
}
