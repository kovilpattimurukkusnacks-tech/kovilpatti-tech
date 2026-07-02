/**
 * Shared query-string builder used across `src/api/<resource>/api.ts` modules.
 *
 * Behaviour (union of what the previous per-module implementations did):
 *   - `undefined` / `null` values are skipped entirely.
 *   - Arrays are comma-joined; empty arrays are skipped (treated as "any").
 *   - Everything else is stringified via `String(value)`.
 *   - Returns `''` when there are no params, otherwise `?key=value&...`.
 */
export type QueryParamValue = string | number | boolean | null | undefined | (string | number)[]

export function buildQuery(params: Record<string, QueryParamValue>): string {
  const p = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      p.set(key, value.join(','))
      continue
    }
    // Match the previous per-module implementations: numbers (including 0)
    // are kept via `!= null` semantics, but empty strings are treated as
    // "not provided" and omitted (matches the old truthy-check callers).
    if (typeof value === 'string' && value === '') continue
    p.set(key, String(value))
  }
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}
