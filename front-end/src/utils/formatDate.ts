// Canonical date/time formatters for the whole app. All timestamps in the
// database are timestamptz (UTC); the UI renders them in IST (Asia/Kolkata).
//
// Format: "26 May 2026, 2.30pm" — day-month-year, 12h, dot separator in time,
// no space before am/pm, lowercase. Built via formatToParts to bypass the
// locale-default comma after month and colon in time.

function buildIst(date: Date, includeDate: boolean): string {
  const fmt = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    ...(includeDate ? { day: 'numeric', month: 'short', year: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const parts = fmt.formatToParts(date)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''

  const hour      = get('hour')
  const minute    = get('minute')
  // dayPeriod can come back as "pm", "PM", "p.m.", " pm" depending on the
  // ICU build — strip spaces/dots and lowercase to land on the canonical "pm".
  const dayPeriod = get('dayPeriod').toLowerCase().replace(/[\s.]/g, '')

  const timePart = `${hour}.${minute}${dayPeriod}`
  if (!includeDate) return timePart

  return `${get('day')} ${get('month')} ${get('year')}, ${timePart}`
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return isNaN(d.getTime()) ? null : d
}

/**
 * "26 May 2026, 2.30pm" — full IST date + time.
 * Returns the fallback (default em-dash) for null/undefined/invalid input.
 */
export function formatIstDateTime(value: string | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value)
  return d ? buildIst(d, true) : fallback
}

/**
 * "2.30pm" — IST time only. Use in recently-saved strips where the date is
 * obvious from context.
 */
export function formatIstTime(value: string | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value)
  return d ? buildIst(d, false) : fallback
}
