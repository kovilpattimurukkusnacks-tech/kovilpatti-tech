import { Box, Button } from '@mui/material'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import dayjs from 'dayjs'
import { istToday } from '../utils/istDate'

// Re-export so existing `import { istToday } from '…/DateRangeFilter'` sites
// keep working — the single implementation lives in utils/istDate.ts.
export { istToday } from '../utils/istDate'

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
 *
 * MUI DatePickers (not native type="date" inputs) so the display format is
 * DD/MM/YYYY on every machine — native inputs follow the OS locale, which is
 * exactly the ambiguity the client flagged. Values stay YYYY-MM-DD / ''.
 */
export default function DateRangeFilter({ from, to, onChange, hideLabel }: Props) {
  const today = istToday()
  // The reset button takes you back to today/today (the default), not to an
  // empty all-dates state. Only shown when you've moved away from today.
  const isToday = from === today && to === today
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      {!hideLabel && <Box sx={{ fontSize: 12, fontWeight: 600, color: '#1F1F1F99' }}>Date:</Box>}
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <DatePicker
          label="From"
          format="DD/MM/YYYY"
          value={from ? dayjs(from) : null}
          // Can't pick a From later than To.
          maxDate={to ? dayjs(to) : undefined}
          onChange={(v) => {
            if (v === null) onChange('', to)            // cleared = no bound
            else if (v.isValid()) onChange(v.format('YYYY-MM-DD'), to)
          }}
          slotProps={{ textField: { size: 'small', sx: { width: 170 } } }}
        />
        <DatePicker
          label="To"
          format="DD/MM/YYYY"
          value={to ? dayjs(to) : null}
          // Can't pick a To earlier than From.
          minDate={from ? dayjs(from) : undefined}
          onChange={(v) => {
            if (v === null) onChange(from, '')
            else if (v.isValid()) onChange(from, v.format('YYYY-MM-DD'))
          }}
          slotProps={{ textField: { size: 'small', sx: { width: 170 } } }}
        />
      </LocalizationProvider>
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
