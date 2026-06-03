import { useMemo } from 'react'
import {
  Autocomplete, Box, Button, Card, CardContent, Chip, TextField,
} from '@mui/material'
import { useCategories } from '../../hooks/useCategories'
import { useShops } from '../../hooks/useShops'
import type { AccountsFilters } from '../../api/accounts/types'

type Props = {
  filters: AccountsFilters
  onChange: (next: AccountsFilters) => void
}

/** ISO yyyy-MM-dd for the IST calendar day at offset `dayOffset` from today. */
function istDate(dayOffset = 0): string {
  // en-CA locale + Asia/Kolkata timezone returns yyyy-MM-dd in IST.
  const now = new Date()
  const istToday = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  istToday.setDate(istToday.getDate() + dayOffset)
  return istToday.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

/** Monday-of-current-IST-week, yyyy-MM-dd. */
function istMondayOfThisWeek(): string {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const dow = today.getDay() // 0=Sun .. 6=Sat
  const offsetToMon = dow === 0 ? -6 : 1 - dow
  today.setDate(today.getDate() + offsetToMon)
  return today.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function istFirstOfThisMonth(): string {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const y = today.getFullYear()
  const m = today.getMonth()
  return new Date(y, m, 1).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function istFirstOfPrevMonth(): string {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const y = today.getFullYear()
  const m = today.getMonth()
  return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function istLastOfPrevMonth(): string {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const y = today.getFullYear()
  const m = today.getMonth()
  return new Date(y, m, 0).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

type Preset = { key: string; label: string; from: () => string; to: () => string }
const PRESETS: Preset[] = [
  { key: 'today',      label: 'Today',       from: () => istDate(),                to: () => istDate() },
  { key: 'yesterday',  label: 'Yesterday',   from: () => istDate(-1),              to: () => istDate(-1) },
  { key: 'this-week',  label: 'This week',   from: istMondayOfThisWeek,            to: () => istDate() },
  { key: 'last-30',    label: 'Last 30 days', from: () => istDate(-29),            to: () => istDate() },
  { key: 'this-month', label: 'This month',  from: istFirstOfThisMonth,            to: () => istDate() },
  { key: 'last-month', label: 'Last month',  from: istFirstOfPrevMonth,            to: istLastOfPrevMonth },
]

/**
 * Date-range + multi-select filter bar above the dashboard. Filter state
 * lives in the URL; this component just renders + emits changes. Presets
 * shift only the date range — other filters (shop / category) are preserved.
 */
export default function AccountsFilterBar({ filters, onChange }: Props) {
  const { data: shopsData }       = useShops()
  const { data: categoriesData }  = useCategories()

  const shops       = shopsData ?? []
  const categories  = useMemo(() => (categoriesData ?? []).filter(c => !c.parentId || true), [categoriesData])
  // ^ keep all categories (root + descendants) — the BE expands selected ids
  // into their full subtree, so a user picking "Biscuits" includes everything
  // under it without us having to dedupe here.

  const selectedShops      = shops.filter(s => filters.shopIds?.includes(s.id))
  const selectedCategories = categories.filter(c => filters.categoryIds?.includes(c.id))

  const applyPreset = (p: Preset) => onChange({ ...filters, from: p.from(), to: p.to() })

  return (
    <Card sx={{ border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835' }}>
      <CardContent>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', mb: 1.5 }}>
          {PRESETS.map(p => (
            <Button
              key={p.key}
              size="small"
              variant="outlined"
              onClick={() => applyPreset(p)}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              {p.label}
            </Button>
          ))}
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
          <TextField
            type="date"
            size="small"
            label="From"
            value={filters.from}
            onChange={e => onChange({ ...filters, from: e.target.value })}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: filters.to } }}
          />
          <TextField
            type="date"
            size="small"
            label="To"
            value={filters.to}
            onChange={e => onChange({ ...filters, to: e.target.value })}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: filters.from } }}
          />
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
                return <Chip key={key} size="small" label={option.code} {...itemProps} />
              })
            }
          />
          <Autocomplete
            multiple
            size="small"
            options={categories}
            value={selectedCategories}
            getOptionLabel={(o) => o.path ?? o.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            onChange={(_, vals) => onChange({ ...filters, categoryIds: vals.length ? vals.map(v => v.id) : undefined })}
            renderInput={(params) => <TextField {...params} label="Categories" />}
            renderValue={(value, getItemProps) =>
              value.map((option, index) => {
                const { key, ...itemProps } = getItemProps({ index })
                return <Chip key={key} size="small" label={option.name} {...itemProps} />
              })
            }
          />
        </Box>
      </CardContent>
    </Card>
  )
}
