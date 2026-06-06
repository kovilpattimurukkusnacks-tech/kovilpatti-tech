// Canonical IST calendar-date helpers. The ONLY safe pattern: read the IST
// wall-clock parts once via Intl.formatToParts, then do all arithmetic in
// UTC space (Date.UTC + toISOString), which is timezone-free.
//
// The bug this replaces: `new Date(now.toLocaleString(…, { timeZone: IST }))`
// parses the IST wall-clock string as MACHINE-LOCAL time, and a later
// `toLocaleDateString(…, { timeZone: IST })` converts to IST a second time.
// On any machine west of IST the result lands a day ahead ("Today" showed
// tomorrow). Never reintroduce that double conversion.

/** Current IST calendar parts (year / month 1-12 / day 1-31). */
function istParts(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const get = (t: string) => Number(parts.find(p => p.type === t)!.value)
  return { y: get('year'), m: get('month'), d: get('day') }
}

/**
 * YYYY-MM-DD from calendar parts. Date.UTC normalises out-of-range values
 * (day 0 = last day of the previous month, month 0 = December last year),
 * which gives the first/last-of-month and week helpers below for free.
 */
function ymd(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
}

/** YYYY-MM-DD for the current IST calendar day. */
export function istToday(): string {
  const { y, m, d } = istParts()
  return ymd(y, m, d)
}

/** YYYY-MM-DD for the IST calendar day at `offsetDays` from today. */
export function istDate(offsetDays = 0): string {
  const { y, m, d } = istParts()
  return ymd(y, m, d + offsetDays)
}

/** Monday of the current IST week, YYYY-MM-DD. */
export function istMondayOfThisWeek(): string {
  const { y, m, d } = istParts()
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=Sun .. 6=Sat
  return ymd(y, m, d + (dow === 0 ? -6 : 1 - dow))
}

/** First day of the current IST month, YYYY-MM-DD. */
export function istFirstOfThisMonth(): string {
  const { y, m } = istParts()
  return ymd(y, m, 1)
}

/** First day of the previous IST month, YYYY-MM-DD. */
export function istFirstOfPrevMonth(): string {
  const { y, m } = istParts()
  return ymd(y, m - 1, 1)
}

/** Last day of the previous IST month, YYYY-MM-DD. */
export function istLastOfPrevMonth(): string {
  const { y, m } = istParts()
  return ymd(y, m, 0)
}
