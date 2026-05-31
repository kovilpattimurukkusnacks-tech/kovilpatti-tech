/**
 * Money + number formatters used across the app.
 *
 * Uses `en-IN` locale so amounts read in the Indian numbering system —
 * commas after the first three digits, then every two:
 *   68268      → 68,268
 *   530000     → 5,30,000
 *   12345678.5 → 1,23,45,678.50
 *
 * Always prints two decimal places to stay invoice-style.
 */

const inrNumberFmt = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Format a number as `₹ 5,30,000.00`. Null / undefined → em-dash.
 * Pass `prefix: false` to drop the `₹ ` (useful when the symbol is
 * rendered separately, e.g. in a chip).
 */
export function formatINR(amount: number | null | undefined, opts: { prefix?: boolean } = {}): string {
  if (amount == null || Number.isNaN(amount)) return '—'
  const n = inrNumberFmt.format(amount)
  return opts.prefix === false ? n : `₹ ${n}`
}
