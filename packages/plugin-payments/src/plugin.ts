/**
 * The provider-neutral plugin — what goes into `theo.config.ts`.
 *
 * The contract went multi-provider before this did, and for a while that was a
 * real inconsistency in the shipped surface: `payments()` from `/stripe`
 * returns a `getStripeClient()`, so the *plugin* a consumer wires knew exactly
 * one gateway while the *types* it programmed against knew several.
 *
 * What this holds is deliberately small — the providers, one idempotency store,
 * one handler registry — because that is what a webhook route needs and the
 * plugin runner does not route HTTP for us. Anything more would be a framework
 * inside a plugin.
 */

import type { TheoApp, TheoPlugin } from 'theokit/server'

import {
  PaymentEventRegistry,
  processPaymentWebhook,
  type PaymentWebhookResult,
} from './dispatch.js'
import { createMemoryStore, type IdempotencyStore } from './idempotency-store.js'
import { type PaymentProvider, type WebhookRequest } from './provider-types.js'

export interface MultiProviderPaymentsOptions {
  /**
   * The gateways this app accepts, keyed by the name it routes them under.
   *
   * A map rather than an array because a webhook arrives at a URL and the URL
   * is what says which gateway sent it — `/api/payments/webhook/[gateway]`.
   * Deriving the key from `provider.name` would work until someone wired two
   * Stripe accounts, which is a real thing (marketplace, separate legal
   * entities) and would silently collapse into one.
   */
  readonly providers: Readonly<Record<string, PaymentProvider>>
  /**
   * Shared across every provider. Event ids are namespaced by provider inside
   * {@link processPaymentWebhook}, so one store is safe and one store is what
   * makes a single database table enough.
   */
  readonly idempotencyStore?: IdempotencyStore
  /** Pass one to register handlers before the plugin is constructed. */
  readonly registry?: PaymentEventRegistry
}

/**
 * What a route handler gets on `ctx.payments`.
 *
 * Narrower than the plugin on purpose, and the narrowing buys a safety property
 * rather than tidiness: a handler holding `store` could claim or release an
 * event id outside the dispatcher and defeat idempotency; one holding `registry`
 * could rewire routing mid-request. Neither is something a request should be
 * able to do, so neither is reachable from one.
 */
export interface PaymentsRequestSurface {
  readonly providers: Readonly<Record<string, PaymentProvider>>
  provider(key: string): PaymentProvider
  handleWebhook(gateway: string, request: WebhookRequest): Promise<PaymentWebhookResult>
}

/** The key `ctx.payments` is published under. Fixed, so a handler can rely on it. */
export const PAYMENTS_DECORATION_KEY = 'payments'

/**
 * The plugin {@link payments} returns.
 *
 * `providers` is a map rather than a single provider because the choice is per-charge, not per-app:
 * the same shop can take cards through Stripe and PIX through AbacatePay. `store` and `registry` are
 * exposed so a handler can deduplicate and dispatch a webhook that arrived outside the usual path.
 */
export interface MultiProviderPaymentsPlugin extends TheoPlugin {
  readonly name: '@theokit/plugin-payments'
  readonly kind: 'payments'
  readonly providers: Readonly<Record<string, PaymentProvider>>
  readonly store: IdempotencyStore
  readonly registry: PaymentEventRegistry
  /** The provider registered under `key`, or a listing of what is. */
  provider(key: string): PaymentProvider
  /**
   * Verify, deduplicate and dispatch one inbound webhook.
   *
   * The whole reason the plugin holds anything: a route handler becomes one
   * call, and the consumer never has to remember which store goes with which
   * provider.
   */
  handleWebhook(gateway: string, request: WebhookRequest): Promise<PaymentWebhookResult>
  /**
   * Publish {@link PaymentsRequestSurface} on `ctx.payments`.
   *
   * `TheoApp` and `TheoPlugin` are imported type-only, so the framework is a
   * compile-time contract and not a runtime dependency — `import type` is erased
   * at build. The `plugin()` builder in `theokit/server/define` would produce
   * the same `{ name, register }` and cost a real import, which rung 4 of the
   * parsimony ladder rules out.
   */
  register(app: TheoApp): void
}

/**
 * Wire one or more payment gateways into a TheoKit app.
 *
 * ```ts
 * import { payments } from '@theokit/plugin-payments'
 * import { StripeProvider } from '@theokit/plugin-payments/stripe'
 * import { AbacatePayProvider } from '@theokit/plugin-payments/abacatepay'
 *
 * payments({
 *   providers: {
 *     stripe: StripeProvider({ client, webhookSecret }),
 *     abacatepay: AbacatePayProvider({ apiKey, webhookSecret }),
 *   },
 * })
 * ```
 *
 * @public
 */
export function payments(opts: MultiProviderPaymentsOptions): MultiProviderPaymentsPlugin {
  const keys = Object.keys(opts.providers ?? {})
  if (keys.length === 0) {
    // Boot-time, like definePaymentProvider: a payments plugin with no gateway
    // is a config mistake, and finding it at the first checkout is finding it
    // in front of a customer.
    throw new TypeError(
      'payments({ providers }): at least one provider is required. Import one from @theokit/plugin-payments/stripe or /abacatepay.',
    )
  }

  const store = opts.idempotencyStore ?? createMemoryStore()
  if (opts.idempotencyStore === undefined && process.env.NODE_ENV === 'production') {
    console.warn(
      '[plugin-payments] Using the default in-memory idempotency store in production. ' +
        'It is NOT multi-replica safe — the same webhook event may be processed ' +
        'more than once across replicas. Pass an explicit `idempotencyStore` ' +
        '(e.g. createOrmStore(repo) backed by a UNIQUE event_id) for production deployments.',
    )
  }
  const registry = opts.registry ?? new PaymentEventRegistry()
  const providers = { ...opts.providers }

  function provider(key: string): PaymentProvider {
    const found = providers[key]
    if (found === undefined) {
      // Naming what IS registered turns a typo from a debugging session into a
      // one-line fix — the caller is usually reading a URL segment they got
      // slightly wrong.
      throw new TypeError(
        `No payment provider registered under "${key}". Registered: ${keys.join(', ')}.`,
      )
    }
    return found
  }

  function handleWebhook(gateway: string, request: WebhookRequest): Promise<PaymentWebhookResult> {
    return processPaymentWebhook({
      provider: provider(gateway),
      request,
      registry,
      store,
      // The routing key, not provider.name: two gateways can share a name and
      // must not share an idempotency namespace.
      namespace: gateway,
    })
  }

  return {
    name: '@theokit/plugin-payments',
    kind: 'payments',
    providers,
    store,
    registry,
    provider,
    handleWebhook,
    register(app: TheoApp): void {
      // No route is registered here because a plugin CANNOT register one:
      // `TheoApp` offers `addHook` and `decorateRequest`, and nothing else.
      // Routes come from the `route()` builder, which the consumer uses in its
      // own route files. Earlier prose in this package called that a design
      // choice; it is a platform constraint (#42).
      //
      // No hook either, and that is the choice: a payments plugin adding an
      // onRequest hook would run on every request in the app, including the
      // ones that never touch money.
      app.decorateRequest<PaymentsRequestSurface>(PAYMENTS_DECORATION_KEY, {
        providers,
        provider,
        handleWebhook,
      })
    },
  }
}
