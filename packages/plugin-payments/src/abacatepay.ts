/**
 * `@theokit/plugin-payments/abacatepay` — the AbacatePay gateway.
 *
 * No SDK and no peer dependency: it speaks REST over `fetch`. Importing this
 * subpath costs nothing beyond the module itself.
 *
 * ```ts
 * import { AbacatePayProvider } from '@theokit/plugin-payments/abacatepay'
 * import { supportsPix } from '@theokit/plugin-payments'
 *
 * const provider = AbacatePayProvider({
 *   apiKey: process.env.ABACATEPAY_API_KEY!,
 *   webhookSecret: process.env.ABACATEPAY_WEBHOOK_SECRET,
 * })
 *
 * if (supportsPix(provider)) {
 *   const { brCode, brCodeBase64 } = await provider.createPixCharge({ amountInCents: 10_000 })
 * }
 * ```
 *
 * @public
 */

export {
  ABACATEPAY_DOCUMENTED_PUBLIC_KEY,
  AbacatePayProvider,
  type AbacatePayProviderOptions,
  type FetchLike,
} from './providers/abacatepay.js'
