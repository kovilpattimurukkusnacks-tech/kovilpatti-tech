import { Autocomplete, Button, Chip, TextField } from '@mui/material'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import dayjs from 'dayjs'
import { FilterBar, FilterRow } from '../FilterBar'
import {
  istDate, istFirstOfPrevMonth, istFirstOfThisMonth, istLastOfPrevMonth,
  istMondayOfThisWeek,
} from '../../utils/istDate'
import { useShops } from '../../hooks/useShops'
import type { AccountsFilters } from '../../api/accounts/types'

type Props = {
  filters: AccountsFilters
  /** Key of the preset the user clicked (URL `preset` param), or null. */
  activePresetKey: string | null
  /**
   * presetKey semantics: a string sets the clicked preset, `null` clears it
   * (manual date edit), `undefined` leaves it untouched (shop change).
   */
  onChange: (next: AccountsFilters, presetKey?: string | null) => void
}

type Preset = { key: string; label: string; from: () => string; to: () => string }
const PRESETS: Preset[] = [
  { key: 'today',      label: 'Today',        from: () => istDate(),     to: () => istDate() },
  { key: 'yesterday',  label: 'Yesterday',    from: () => istDate(-1),   to: () => istDate(-1) },
  { key: 'this-week',  label: 'This week',    from: istMondayOfThisWeek, to: () => istDate() },
  { key: 'last-30',    label: 'Last 30 days', from: () => istDate(-29),  to: () => istDate() },
  { key: 'this-month', label: 'This month',   from: istFirstOfThisMonth, to: () => istDate() },
  { key: 'last-month', label: 'Last month',   from: istFirstOfPrevMonth, to: istLastOfPrevMonth },
]

/**
 * Accounts filter controls, rendered inside the page's collapsible
 * FilterPanel (AdminAccounts owns the open state + pills — same pattern as
 * AdminRequests). Filter state lives in the URL; this component just renders
 * + emits changes. Presets shift only the date range — the shop filter is
 * preserved.
 *
 * Highlight = the preset the user CLICKED (tracked via the `preset` URL
 * param), not "any preset whose range matches" — two presets can produce
 * the same range (e.g. This week == This month during the first week of a
 * month) and showing both gold confused the client. The clicked key only
 * stays highlighted while its computed range still equals the filters, so
 * a stale shared link can't show a wrong highlight.
 */
export default function AccountsFilterBar({ filters, activePresetKey, onChange }: Props) {
  const { data: shopsData } = useShops()

  const shops         = shopsData ?? []
  const selectedShops = shops.filter(s => filters.shopIds?.includes(s.id))

  const applyPreset = (p: Preset) => onChange({ ...filters, from: p.from(), to: p.to() }, p.key)

  return (
    <FilterBar>
      <FilterRow label="Quick">
        {PRESETS.map(p => {
          const active = p.key === activePresetKey
                      && p.from() === filters.from && p.to() === filters.to
          return (
            <Button
              key={p.key}
              size="small"
              disableElevation
              // Contained = the theme's gold gradient; outlined = inactive.
              variant={active ? 'contained' : 'outlined'}
              onClick={() => applyPreset(p)}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              {p.label}
            </Button>
          )
        })}
      </FilterRow>

      {/* Date pickers + Shops share one row (wraps on narrow screens).
          Dates stored/emitted as YYYY-MM-DD; displayed DD/MM/YYYY. */}
      <FilterRow label="Date">
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <DatePicker
            label="From"
            format="DD/MM/YYYY"
            value={filters.from ? dayjs(filters.from) : null}
            maxDate={filters.to ? dayjs(filters.to) : undefined}
            onChange={(v) => { if (v && v.isValid()) onChange({ ...filters, from: v.format('YYYY-MM-DD') }, null) }}
            slotProps={{ textField: { size: 'small', sx: { width: 170 } } }}
          />
          <DatePicker
            label="To"
            format="DD/MM/YYYY"
            value={filters.to ? dayjs(filters.to) : null}
            minDate={filters.from ? dayjs(filters.from) : undefined}
            onChange={(v) => { if (v && v.isValid()) onChange({ ...filters, to: v.format('YYYY-MM-DD') }, null) }}
            slotProps={{ textField: { size: 'small', sx: { width: 170 } } }}
          />
        </LocalizationProvider>
        <Autocomplete
          multiple
          size="small"
          options={shops}
          value={selectedShops}
          getOptionLabel={(o) => `${o.code} — ${o.name}`}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          onChange={(_, vals) => onChange({ ...filters, shopIds: vals.length ? vals.map(v => v.id) : undefined })}
          renderInput={(params) => <TextField {...params} label="Shops" />}
          renderValue={(value, getItemProps) =>
            value.map((option, index) => {
              const { key, ...itemProps } = getItemProps({ index })
              return <Chip key={key} size="small" label={option.name} {...itemProps} />
            })
          }
          sx={{ flex: 1, minWidth: 280, maxWidth: 560 }}
        />
      </FilterRow>
    </FilterBar>
  )
}
