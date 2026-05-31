import { Box, Button, TextField } from '@mui/material'

/** YYYY-MM-DD for the current IST calendar day. Used as the default range. */
export function istToday(): string {
  // en-CA formats as YYYY-MM-DD; timeZone pins it to the IST calendar day.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

/** "27 May" from a YYYY-MM-DD string (built from parts → no timezone shift). */
function fmtDayMonth(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/**
 * Short human label for the active date range, used on the collapsed
 * filter summary pill. "Today" when both ends are today, a single day when
 * from==to, a range otherwise, "All dates" when both empty.
 */
export function dateRangeLabel(from: string, to: string): string {
  const today = istToday()
  if (!from && !to) return 'All dates'
  if (from === today && to === today) return 'Today'
  if (from && from === to) return fmtDayMonth(from)
  if (from && to) return `${fmtDayMonth(from)} – ${fmtDayMonth(to)}`
  if (from) return `From ${fmtDayMonth(from)}`
  return `Until ${fmtDayMonth(to)}`
}

type Props = {
  /** YYYY-MM-DD or '' (no lower bound). */
  from: string
  /** YYYY-MM-DD or '' (no upper bound). */
  to: string
  /** Fired with the new (from, to) pair on any change, including Clear. */
  onChange: (from: string, to: string) => void
  /** Hide the inline "Date:" label (e.g. when a FilterRow already labels it). */
  hideLabel?: boolean
}

/**
 * From–To date range filter used on the stock-request list pages. Filters on
 * submitted_at (IST). Empty strings = no bound. The parent owns the state and
 * decides the default (today/today on these pages).
 */
export default function DateRangeFilter({ from, to, onChange, hideLabel }: Props) {
  const today = istToday()
  // The reset button takes you back to today/today (the default), not to an
  // empty all-dates state. Only shown when you've moved away from today.
  const isToday = from === today && to === today
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      {!hideLabel && <Box sx={{ fontSize: 12, fontWeight: 600, color: '#1F1F1F99' }}>Date:</Box>}
      <TextField
        type="date"
        size="small"
        label="From"
        value={from}
        onChange={e => onChange(e.target.value, to)}
        // Can't pick a From later than To.
        slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: to || undefined } }}
        sx={{ width: 150 }}
      />
      <TextField
        type="date"
        size="small"
        label="To"
        value={to}
        onChange={e => onChange(from, e.target.value)}
        // Can't pick a To earlier than From.
        slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: from || undefined } }}
        sx={{ width: 150 }}
      />
      {!isToday && (
        <Button
          size="small"
          onClick={() => onChange(today, today)}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          Today
        </Button>
      )}
    </Box>
  )
}
