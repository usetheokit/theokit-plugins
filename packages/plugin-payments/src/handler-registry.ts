/**
 * Internal handler registry shared by the Stripe-typed `WebhookRegistry` and the
 * provider-neutral `PaymentEventRegistry`. One body, so a fix reaches both paths.
 */

interface RegisteredHandler<E> {
  readonly eventType: string
  readonly handle: (event: E) => Promise<void>
}

export class HandlerRegistry<E extends { type: string }> {
  private readonly handlers = new Map<string, RegisteredHandler<E>[]>()

  register(handler: RegisteredHandler<E>): void {
    const bucket = this.handlers.get(handler.eventType) ?? []
    bucket.push(handler)
    this.handlers.set(handler.eventType, bucket)
  }

  /**
   * LIFO: the most recently registered handler runs first. ALL handlers run even
   * if some throw; every error is collected and surfaced together as an
   * AggregateError. Unhandled event types are a no-op.
   */
  async dispatch(event: E): Promise<void> {
    const bucket = this.handlers.get(event.type)
    if (bucket === undefined || bucket.length === 0) return
    const errors: unknown[] = []
    for (let i = bucket.length - 1; i >= 0; i--) {
      const handler = bucket[i]
      if (handler === undefined) continue
      try {
        await handler.handle(event)
      } catch (err) {
        errors.push(err)
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `${errors.length} webhook handler(s) failed for event "${event.type}".`,
      )
    }
  }

  hasHandlersFor(eventType: string): boolean {
    const bucket = this.handlers.get(eventType)
    return bucket !== undefined && bucket.length > 0
  }
}
