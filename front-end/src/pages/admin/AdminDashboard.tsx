import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Box, Stack } from '@mui/material'
import PageHeader from '../../components/PageHeader'
import ProfitLossChart from '../../components/accounts/ProfitLossChart'
import MovementChart from '../../components/accounts/MovementChart'
import AccountsFilterBar from '../../components/accounts/AccountsFilterBar'
import DashboardHero from '../../components/dashboard/DashboardHero'
import ProfitByShopChart from '../../components/dashboard/ProfitByShopChart'
import ProfitByCategoryDonut from '../../components/dashboard/ProfitByCategoryDonut'
import { FilterPanel, type FilterPill } from '../../components/FilterBar'
import { dateRangeLabel } from '../../components/DateRangeFilter'
import { useAccountsTrend, useAccountsUtilities, useAccountsGodownExpenses } from '../../hooks/useAccounts'
import { useShops } from '../../hooks/useShops'
import { istToday } from '../../utils/istDate'
import type { AccountsFilters, AccountsGrouping } from '../../api/accounts/types'

/**
 * Admin dashboard (12-Jul-2026, profit-first redesign per client): ONE
 * question answered — did we make money? A hero profit/loss number for the
 * selected dates, then a green-up / red-down bar per period. Same filters
 * as Accounts (presets, From/To, shops) + a Per day / week / month toggle;
 * opens on TODAY by default.
 *
 * Profit per bucket = Net at MRP − Purchased at cost (both from the trend
 * endpoint; cost is the frozen purchase_price_snapshot).
 */
export default function AdminDashboard() {
  const [params, setParams] = useSearchParams()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const { data: shopsData } = useShops()

  // URL → filters. Defaults: TODAY (IST), per-day buckets. Stale shop ids
  // self-heal once the shop list loads (same rule as AdminAccounts).
  const filters: AccountsFilters = useMemo(() => {
    const from = params.get('from') || istToday()
    const to   = params.get('to')   || istToday()
    const groupingRaw = params.get('grouping')
    const grouping: AccountsGrouping =
      groupingRaw === 'week' || groupingRaw === 'month' ? groupingRaw : 'day'
    let shopIds = params.get('shopIds')?.split(',').filter(Boolean)
    if (shopsData && shopIds) {
      const known = new Set(shopsData.map(s => s.id))
      shopIds = shopIds.filter(id => known.has(id))
    }
    return {
      from, to, grouping,
      shopIds: shopIds && shopIds.length > 0 ? shopIds : undefined,
    }
  }, [params, shopsData])

  // Strip stale shop ids from the URL permanently once detected.
  useEffect(() => {
    if (!shopsData) return
    const clean = filters.shopIds?.join(',') ?? ''
    if ((params.get('shopIds') ?? '') === clean) return
    setParams(prev => {
      const out = new URLSearchParams(prev)
      if (clean) out.set('shopIds', clean); else out.delete('shopIds')
      return out
    }, { replace: true })
  }, [params, shopsData, filters, setParams])

  // With no dates in the URL the page is showing Today — highlight that
  // preset so the owner can see at a glance what range they're looking at.
  const activePresetKey = params.get('preset') ?? (params.get('from') ? null : 'today')

  const setFilters = useCallback((next: AccountsFilters, presetKey?: string | null) => {
    setParams(prev => {
      const out = new URLSearchParams(prev)
      out.set('from', next.from)
      out.set('to',   next.to)
      if (presetKey !== undefined) {
        if (presetKey) out.set('preset', presetKey); else out.delete('preset')
      }
      if (next.grouping && next.grouping !== 'day') out.set('grouping', next.grouping); else out.delete('grouping')
      if (next.shopIds && next.shopIds.length) out.set('shopIds', next.shopIds.join(',')); else out.delete('shopIds')
      return out
    }, { replace: true })
  }, [setParams])

  const trend     = useAccountsTrend(filters)
  const utilities = useAccountsUtilities(filters)
  // Godown Expenses (18-Jul-2026) — company-wide Inventory staff salary,
  // feeds Net Profit as its own line alongside Shop Expenses.
  const godownExpenses = useAccountsGodownExpenses(filters)

  // Collapsed-panel pills: date range + one pill per selected shop (by name).
  const activePills: FilterPill[] = [
    { key: 'date', label: dateRangeLabel(filters.from, filters.to) },
    ...(filters.shopIds ?? []).map(id => ({
      key: `shop-${id}`,
      label: shopsData?.find(s => s.id === id)?.name ?? id,
      onRemove: () => {
        const rest = (filters.shopIds ?? []).filter(x => x !== id)
        setFilters({ ...filters, shopIds: rest.length ? rest : undefined })
      },
    })),
  ]

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Dashboard"
        subtitle="Did we make money? Green means profit, red means loss."
      />

      <Stack spacing={2} sx={{ mt: 2 }}>
        <FilterPanel open={filtersOpen} onToggle={() => setFiltersOpen(o => !o)} pills={activePills}>
          <AccountsFilterBar filters={filters} activePresetKey={activePresetKey} onChange={setFilters} />
        </FilterPanel>

        {trend.error && (
          <Alert severity="error" sx={{ borderRadius: 2 }}>
            {trend.error instanceof Error ? trend.error.message : 'Failed to load dashboard data.'}
          </Alert>
        )}

        {/* Executive KPI strip — Revenue / Cost / Profit / Margin with
            inline sparklines. Reads from the same trend payload as the
            charts below, so no extra API call. 12-Jul-2026 client req. */}
        <DashboardHero
          data={trend.data}
          utilities={utilities.data}
          godownExpenses={godownExpenses.data?.amount}
          loading={trend.isLoading || utilities.isLoading || godownExpenses.isLoading}
        />

        {/* All rupee values side by side, like the Accounts screen. */}
        <MovementChart data={trend.data} loading={trend.isLoading} grouping={filters.grouping ?? 'day'} />

        {/* The bottom line: green up = profit, red down = loss. */}
        <ProfitLossChart data={trend.data} loading={trend.isLoading} grouping={filters.grouping ?? 'day'} />

        {/* Advanced breakdowns — two columns side by side:
              LEFT: horizontal bars of profit per shop (sorted by impact).
              RIGHT: category profit donut (where the money comes from). */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: '3fr 2fr' },
            gap: 2,
          }}
        >
          <ProfitByShopChart filters={filters} />
          <ProfitByCategoryDonut filters={filters} />
        </Box>
      </Stack>
    </Box>
  )
}


