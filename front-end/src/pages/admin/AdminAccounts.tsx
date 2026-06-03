import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Box, Stack } from '@mui/material'
import PageHeader from '../../components/PageHeader'
import AccountsFilterBar from '../../components/accounts/AccountsFilterBar'
import KpiStrip from '../../components/accounts/KpiStrip'
import InTransitStrip from '../../components/accounts/InTransitStrip'
import TrendChart from '../../components/accounts/TrendChart'
import ShopBreakdownTable from '../../components/accounts/ShopBreakdownTable'
import CategoryAndProductsTable from '../../components/accounts/CategoryAndProductsTable'
import AdjustmentsLogTable from '../../components/accounts/AdjustmentsLogTable'
import {
  useAccountsAdjustments,
  useAccountsByCategory,
  useAccountsByShop,
  useAccountsInTransit,
  useAccountsSummary,
  useAccountsTopProducts,
  useAccountsTrend,
} from '../../hooks/useAccounts'
import type { AccountsFilters, AccountsGrouping, AccountsTopProductsLimit } from '../../api/accounts/types'

/** Monday of the current IST week — used as the default `from`. */
function istMondayOfThisWeek(): string {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const dow = today.getDay()
  const offset = dow === 0 ? -6 : 1 - dow
  today.setDate(today.getDate() + offset)
  return today.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function istToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

/**
 * Phase 3 Accounts dashboard. Admin-only (route gate + BE re-check). Filter
 * state lives in the URL so a date-pinned link is shareable and a refresh
 * does not lose the filter. Same pattern as AdminRequests.
 */
export default function AdminAccounts() {
  const [params, setParams] = useSearchParams()

  // Parse URL → AccountsFilters object. Empty arrays are not stored — we
  // strip them so the query key in TanStack Query stays stable.
  const filters: AccountsFilters = useMemo(() => {
    const from     = params.get('from') || istMondayOfThisWeek()
    const to       = params.get('to')   || istToday()
    const grouping = (params.get('grouping') as AccountsGrouping | null) ?? 'day'
    const shopIds      = params.get('shopIds')?.split(',').filter(Boolean)
    const inventoryIds = params.get('inventoryIds')?.split(',').filter(Boolean)
    const categoryIds  = params.get('categoryIds')?.split(',').filter(Boolean).map(Number).filter(n => !Number.isNaN(n))
    const limit = Number(params.get('limit')) as AccountsTopProductsLimit
    return {
      from,
      to,
      grouping,
      shopIds:      shopIds && shopIds.length > 0 ? shopIds : undefined,
      inventoryIds: inventoryIds && inventoryIds.length > 0 ? inventoryIds : undefined,
      categoryIds:  categoryIds && categoryIds.length > 0 ? categoryIds : undefined,
      limit: [10, 25, 50].includes(limit) ? limit : 10,
    }
  }, [params])

  const setFilters = useCallback((next: AccountsFilters) => {
    setParams(prev => {
      const out = new URLSearchParams(prev)
      out.set('from', next.from)
      out.set('to',   next.to)
      if (next.grouping && next.grouping !== 'day') out.set('grouping', next.grouping); else out.delete('grouping')
      if (next.shopIds      && next.shopIds.length)      out.set('shopIds',      next.shopIds.join(','));      else out.delete('shopIds')
      if (next.inventoryIds && next.inventoryIds.length) out.set('inventoryIds', next.inventoryIds.join(',')); else out.delete('inventoryIds')
      if (next.categoryIds  && next.categoryIds.length)  out.set('categoryIds',  next.categoryIds.join(','));  else out.delete('categoryIds')
      if (next.limit && next.limit !== 10) out.set('limit', String(next.limit)); else out.delete('limit')
      return out
    }, { replace: true })
  }, [setParams])

  const setTopProductsLimit = useCallback((n: AccountsTopProductsLimit) => {
    setFilters({ ...filters, limit: n })
  }, [filters, setFilters])

  // Queries — every section drives its own request so a single slow SP
  // doesn't block the rest of the page from rendering.
  const summary     = useAccountsSummary(filters)
  const trend       = useAccountsTrend(filters)
  const inTransit   = useAccountsInTransit(filters)
  const byShop      = useAccountsByShop(filters)
  const byCategory  = useAccountsByCategory(filters)
  const topProducts = useAccountsTopProducts(filters)
  const adjustments = useAccountsAdjustments(filters)

  // Surface the first error encountered. Validation failures on the BE
  // (e.g. range > 366 days) come back as ApiError 400.
  const firstError = summary.error || trend.error || inTransit.error || byShop.error
                   || byCategory.error || topProducts.error || adjustments.error

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Accounts"
        subtitle="Stock-movement value (at MRP), by date range. Read-only."
      />

      <Stack spacing={2} sx={{ mt: 2 }}>
        <AccountsFilterBar filters={filters} onChange={setFilters} />

        {firstError && (
          <Alert severity="error" sx={{ borderRadius: 2 }}>
            {firstError instanceof Error ? firstError.message : 'Failed to load accounts data.'}
          </Alert>
        )}

        <KpiStrip data={summary.data} loading={summary.isLoading} />

        <InTransitStrip data={inTransit.data} loading={inTransit.isLoading} />

        <TrendChart
          data={trend.data}
          loading={trend.isLoading}
          grouping={filters.grouping ?? 'day'}
        />

        <ShopBreakdownTable
          rows={byShop.data}
          loading={byShop.isLoading}
          filters={filters}
        />

        <CategoryAndProductsTable
          categoryRows={byCategory.data}
          topProductRows={topProducts.data}
          loadingCategories={byCategory.isLoading}
          loadingProducts={topProducts.isLoading}
          filters={filters}
          topProductsLimit={(filters.limit ?? 10) as AccountsTopProductsLimit}
          onTopProductsLimitChange={setTopProductsLimit}
        />

        <AdjustmentsLogTable
          rows={adjustments.data}
          loading={adjustments.isLoading}
          filters={filters}
        />
      </Stack>
    </Box>
  )
}
