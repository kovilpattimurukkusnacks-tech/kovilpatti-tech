import { Button, MenuItem, TextField } from '@mui/material'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import dayjs from 'dayjs'
import { FilterBar, FilterRow } from '../FilterBar'
import { useShops } from '../../hooks/useShops'
import { istDate, istFirstOfPrevMonth, istFirstOfThisMonth, istLastOfPrevMonth } from '../../utils/istDate'
import { CREAM, type RangePresetKey } from './salesTheme'

export type SalesFilters = {
  from: string        // yyyy-MM-dd (IST)
  to: string
  shopId: string      // '' = all shops
}

const PRESETS: { key: RangePresetKey; label: string; from: () => string; to: () => string }[] = [
  { key: 'today',      label: 'Today',        from: () => istDate(),     to: () => istDate() },
  { key: 'yesterday',  label: 'Yesterday',    from: () => istDate(-1),   to: () => istDate(-1) },
  { key: 'last-7',     label: 'Last 7 days',  from: () => istDate(-6),   to: () => istDate() },
  { key: 'this-month', label: 'This month',   from: istFirstOfThisMonth, to: () => istDate() },
  { key: 'last-month', label: 'Last month',   from: istFirstOfPrevMonth, to: istLastOfPrevMonth },
  { key: 'last-30',    label: 'Last 30 days', from: () => istDate(-29),  to: () => istDate() },
]

/** Date range + shop filter shared by every Sales tab. */
export default function SalesFilterBar({ filters, onChange }: {
  filters: SalesFilters
  onChange: (next: SalesFilters) => void
}) {
  const shops = (useShops().data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))

  return (
    <FilterBar>
      <FilterRow label="Quick">
        {PRESETS.map(p => {
          const active = p.from() === filters.from && p.to() === filters.to
          return (
            <Button
              key={p.key}
              size="small"
              disableElevation
              variant={active ? 'contained' : 'outlined'}
              onClick={() => onChange({ ...filters, from: p.from(), to: p.to() })}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              {p.label}
            </Button>
          )
        })}
      </FilterRow>
      <FilterRow label="Date">
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <DatePicker
            label="From"
            format="DD/MM/YYYY"
            value={dayjs(filters.from)}
            maxDate={dayjs(filters.to)}
            onChange={v => { if (v && v.isValid()) onChange({ ...filters, from: v.format('YYYY-MM-DD') }) }}
            slotProps={{ textField: { size: 'small', sx: { width: 170, bgcolor: CREAM } } }}
          />
          <DatePicker
            label="To"
            format="DD/MM/YYYY"
            value={dayjs(filters.to)}
            minDate={dayjs(filters.from)}
            onChange={v => { if (v && v.isValid()) onChange({ ...filters, to: v.format('YYYY-MM-DD') }) }}
            slotProps={{ textField: { size: 'small', sx: { width: 170, bgcolor: CREAM } } }}
          />
        </LocalizationProvider>
        <TextField
          select
          size="small"
          label="Shop"
          value={filters.shopId}
          onChange={e => onChange({ ...filters, shopId: e.target.value })}
          sx={{ minWidth: 220, bgcolor: CREAM }}
        >
          <MenuItem value="">All shops</MenuItem>
          {shops.map(s => <MenuItem key={s.id} value={s.id}>{s.code} — {s.name}</MenuItem>)}
        </TextField>
      </FilterRow>
    </FilterBar>
  )
}
