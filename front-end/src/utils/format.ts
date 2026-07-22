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

/**
 * Format a raw amount string (digits with optional dot) for live display
 * inside a TextField — en-IN commas on the integer part, decimal kept
 * verbatim so a half-typed value like "1000." doesn't jump.
 *
 *   ''          → ''
 *   '1000'      → '1,000'
 *   '100000'    → '1,00,000'
 *   '100000.'   → '1,00,000.'
 *   '100000.55' → '1,00,000.55'
 *
 * Paired with `stripAmountFormat` on the way back to state / parseFloat.
 */
export function formatAmountInput(raw: string): string {
  if (!raw) return ''
  const [intPart, decPart] = raw.split('.')
  if (!intPart) return decPart !== undefined ? `.${decPart}` : raw
  const num = parseInt(intPart, 10)
  if (Number.isNaN(num)) return raw
  const formatted = num.toLocaleString('en-IN')
  return decPart !== undefined ? `${formatted}.${decPart}` : formatted
}

/** Strip commas + any non-digit/non-dot chars from a formatted amount
 *  string so it can be fed to parseFloat. Keeps only the first dot. */
export function stripAmountFormat(s: string): string {
  let out = s.replace(/[^\d.]/g, '')
  const firstDot = out.indexOf('.')
  if (firstDot !== -1) {
    out = out.slice(0, firstDot + 1) + out.slice(firstDot + 1).replace(/\./g, '')
  }
  return out
}
