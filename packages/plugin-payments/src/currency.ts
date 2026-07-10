/**
 * @theokit/plugin-payments — currency helpers.
 *
 * Per plan p6-plugin-payments v1.0 § Phase 2 / T2.4.
 * Mirrors `references/next.js/examples/with-stripe-typescript/utils/stripe-helpers.ts:1-30`
 * — currency-aware amount conversion for zero-decimal (JPY) vs decimal (USD/EUR/etc) currencies.
 */

// Stripe's authoritative charge-time zero-decimal currency set (docs.stripe.com/currencies).
// Keyed on the lowercase currency code — NEVER inferred from Intl/amount (#200).
// IMPORTANT: ISK, HUF, TWD and UGX are Stripe "special cases" — they are NOT
// zero-decimal at charge time and are charged in 2-decimal minor units (x100).
// Do not add them here even though ICU formats them without decimals.
const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
])

// Stripe charges these in x1000 minor units, rounded to a multiple of 10.
const THREE_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd'])

/**
 * Convert a major-unit amount to the integer minor unit Stripe expects.
 *
 * Detection is by ISO currency code against Stripe's published static sets —
 * NOT `Intl` introspection, which is amount/ICU-dependent and undercharged
 * codes like ISK/HUF/UGX 100x (#200). Scaling is integer-exact (no binary-float
 * `amount * 100`, #199): `1.005 USD → 101` (round-half-up), not the float
 * artifact `100`.
 *
 * Throws (fail-loud, Inquebrável Rule 8) on: non-finite or negative amounts, a
 * non-integer amount for a zero-decimal currency, or a minor-unit value that
 * would exceed `Number.MAX_SAFE_INTEGER` (EC-5).
 */
export function formatAmountForStripe(amount: number, currency: string): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`formatAmountForStripe: amount must be a finite number, got ${amount}`)
  }
  if (amount < 0) {
    throw new RangeError(`formatAmountForStripe: amount must be non-negative, got ${amount}`)
  }
  const code = currency.toLowerCase()

  if (ZERO_DECIMAL_CURRENCIES.has(code)) {
    if (!Number.isInteger(amount)) {
      throw new RangeError(
        `formatAmountForStripe: zero-decimal currency "${currency}" requires an integer amount, got ${amount}`,
      )
    }
    return assertSafeMinorUnits(amount, currency)
  }

  const decimals = THREE_DECIMAL_CURRENCIES.has(code) ? 3 : 2
  let minor = scaleToMinorUnits(amount, decimals)
  if (decimals === 3 && minor % 10 !== 0) {
    // Stripe requires 3-decimal charge amounts to be a multiple of 10.
    minor = Math.round(minor / 10) * 10
  }
  return assertSafeMinorUnits(minor, currency)
}

/**
 * Scale a major-unit amount to integer minor units WITHOUT binary-float
 * multiplication (#199). Uses the number's shortest round-trip string so the
 * decimal the caller intended is recovered, then rounds half-up at the digit
 * just past the currency's precision.
 */
function scaleToMinorUnits(amount: number, decimals: number): number {
  const s = amount.toString()
  if (s.includes('e') || s.includes('E')) {
    throw new RangeError(`formatAmountForStripe: amount ${amount} is out of the supported range`)
  }
  const [intPart, fracRaw = ''] = s.split('.')
  const keep = fracRaw.slice(0, decimals).padEnd(decimals, '0')
  const roundUp = fracRaw.charCodeAt(decimals) - 48 >= 5 // (decimals+1)th digit
  const base = Number(`${intPart}${keep}`)
  return roundUp ? base + 1 : base
}

function assertSafeMinorUnits(minor: number, currency: string): number {
  if (minor > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(
      `formatAmountForStripe: minor-unit amount for "${currency}" exceeds MAX_SAFE_INTEGER (${minor})`,
    )
  }
  return minor
}

/**
 * Format an amount for human display using the consumer's locale + currency.
 *
 * Returns a localized string (e.g., `"$1.50"` for USD, `"¥1,500"` for JPY).
 */
export function formatAmountForDisplay(amount: number, currency: string): string {
  const numberFormat = new Intl.NumberFormat(['en-US'], {
    style: 'currency',
    currency,
    currencyDisplay: 'symbol',
  })
  return numberFormat.format(amount)
}
