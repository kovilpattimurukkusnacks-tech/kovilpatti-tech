import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Box, Stack } from '@mui/material'
import PageHeader from '../../components/PageHeader'
import { istFirstOfThisMonth, istToday } from '../../utils/istDate'
import { dateRangeLabel } from '../../components/DateRangeFilter'
import { FilterPanel, type FilterPill } from '../../components/FilterBar'
import AccountsFilterBar from '../../components/accounts/AccountsFilterBar'
import KpiStrip from '../../components/accounts/KpiStrip'
import InTransitStrip from '../../components/accounts/InTransitStrip'
import ShopBreakdownTable from '../../components/accounts/ShopBreakdownTable'
import CategoryAndProductsTable from '../../components/accounts/CategoryAndProductsTable'
import AdjustmentsLogTable from '../../components/accounts/AdjustmentsLogTable'
import { useShops } from '../../hooks/useShops'
import { useCategories } from '../../hooks/useCategories'
import {
  useAccountsAdjustments,
  useAccountsByCategory,
  useAccountsByShop,
  useAccountsInTransit,
  useAccountsSummary,
  useAccountsTopProducts,
} from '../../hooks/useAccounts'
import type { AccountsFilters, AccountsGrouping, AccountsTopProductsLimit } from '../../api/accounts/types'

/**
 * Phase 3 Accounts dashboard. Admin-only (route gate + BE re-check). Filter
 * state lives in the URL so a date-pinned link is shareable and a refresh
 * does not lose the filter. Same pattern as AdminRequests.
 */
export default function AdminAccounts() {
  const [params, setParams] = useSearchParams()
  // Collapsible filter panel — collapsed by default, same as the
  // stock-request list pages. Transient UI state, not part of the URL.
  const [filtersOpen, setFiltersOpen] = useState(false)

  // The shop / category lists drive the filter pickers AND let us drop stale
  // ids (see below). React Query dedupes — the filter bar reads the same
  // cached queries.
  const { data: shopsData }      = useShops()
  const { data: categoriesData } = useCategories()

  // Parse URL → AccountsFilters object. Empty arrays are not stored — we
  // strip them so the query key in TanStack Query stays stable. On first load
  // (no from/to in the URL) the range defaults to the current IST month.
  const filters: AccountsFilters = useMemo(() => {
    const from     = params.get('from') || istFirstOfThisMonth()
    const to       = params.get('to')   || istToday()
    const grouping = (params.get('grouping') as AccountsGrouping | null) ?? 'day'
    let shopIds     = params.get('shopIds')?.split(',').filter(Boolean)
    let categoryIds = params.get('categoryIds')?.split(',').filter(Boolean).map(Number).filter(n => !Number.isNaN(n))

    // Self-healing filters: once the lists have loaded, drop any id that no
    // longer matches a real shop / category (e.g. after data was re-seeded
    // with new ids, or an old shared link). Without this, an id that resolves
    // to nothing becomes an invisible filter that silently zeroes the whole
    // page. Until the lists load we leave the ids untouched.
    if (shopsData && shopIds) {
      const known = new Set(shopsData.map(s => s.id))
      shopIds = shopIds.filter(id => known.has(id))
    }
    if (categoriesData && categoryIds) {
      const known = new Set(categoriesData.map(c => c.id))
      categoryIds = categoryIds.filter(id => known.has(id))
    }

    const limit = Number(params.get('limit')) as AccountsTopProductsLimit
    return {
      from,
      to,
      grouping,
      shopIds:     shopIds && shopIds.length > 0 ? shopIds : undefined,
      categoryIds: categoryIds && categoryIds.length > 0 ? categoryIds : undefined,
      limit: [10, 25, 50].includes(limit) ? limit : 10,
    }
  }, [params, shopsData, categoriesData])

  // Permanently strip stale / removed filters from the URL once we can tell
  // they don't resolve, so a broken or old link doesn't stay stuck on a zero
  // result. (`inventoryIds` is always removed — the Godowns filter is gone.)
  useEffect(() => {
    if (!shopsData && !categoriesData) return
    const cleanShops = filters.shopIds?.join(',') ?? ''
    const cleanCats  = filters.categoryIds?.join(',') ?? ''
    const shopsStale = (params.get('shopIds') ?? '') !== cleanShops
    const catsStale  = (params.get('categoryIds') ?? '') !== cleanCats
    const invStale   = params.get('inventoryIds') !== null
    if (!shopsStale && !catsStale && !invStale) return
    setParams(prev => {
      const out = new URLSearchParams(prev)
      out.delete('inventoryIds')
      if (cleanShops) out.set('shopIds', cleanShops); else out.delete('shopIds')
      if (cleanCats)  out.set('categoryIds', cleanCats); else out.delete('categoryIds')
      return out
    }, { replace: true })
  }, [params, shopsData, categoriesData, filters, setParams])

  // Which quick-preset button the user clicked (drives the gold highlight).
  // URL state so it survives refresh and the filter panel's unmountOnExit.
  const activePresetKey = params.get('preset')

  /**
   * presetKey: string = a preset button was clicked, null = manual date edit
   * (clears the highlight), undefined = unrelated change (shop / limit) —
   * leave the preset as-is.
   */
  const setFilters = useCallback((next: AccountsFilters, presetKey?: string | null) => {
    setParams(prev => {
      const out = new URLSearchParams(prev)
      out.set('from', next.from)
      out.set('to',   next.to)
      if (presetKey !== undefined) {
        if (presetKey) out.set('preset', presetKey); else out.delete('preset')
      }
      if (next.grouping && next.grouping !== 'day') out.set('grouping', next.grouping); else out.delete('grouping')
      if (next.shopIds      && next.shopIds.length)      out.set('shopIds',      next.shopIds.join(','));      else out.delete('shopIds')
      if (next.categoryIds  && next.categoryIds.length)  out.set('categoryIds',  next.categoryIds.join(','));  else out.delete('categoryIds')
      if (next.limit && next.limit !== 10) out.set('limit', String(next.limit)); else out.delete('limit')
      return out
    }, { replace: true })
  }, [setParams])

  const setTopProductsLimit = useCallback((n: AccountsTopProductsLimit) => {
    setFilters({ ...filters, limit: n })
  }, [filters, setFilters])

  // Active-filter pills shown while the panel is collapsed. The date pill has
  // no ✕ — the range always applies (defaults to this month) and is changed
  // via the expanded panel. Shop pills show the NAME and their ✕ removes
  // just that shop. Same pattern as AdminRequests.
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

  // Queries — every section drives its own request so a single slow SP
  // doesn't block the rest of the page from rendering.
  const summary     = useAccountsSummary(filters)
  const inTransit   = useAccountsInTransit(filters)
  const byShop      = useAccountsByShop(filters)
  const byCategory  = useAccountsByCategory(filters)
  const topProducts = useAccountsTopProducts(filters)
  const adjustments = useAccountsAdjustments(filters)

  // Surface the first error encountered. Validation failures on the BE
  // (e.g. range > 366 days) come back as ApiError 400.
  const firstError = summary.error || inTransit.error || byShop.error
                   || byCategory.error || topProducts.error || adjustments.error

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Accounts"
        subtitle="Stock-movement value (at MRP), by date range. Read-only."
      />

      <Stack spacing={2} sx={{ mt: 2 }}>
        <FilterPanel open={filtersOpen} onToggle={() => setFiltersOpen(o => !o)} pills={activePills}>
          <AccountsFilterBar filters={filters} activePresetKey={activePresetKey} onChange={setFilters} />
        </FilterPanel>

        {firstError && (
          <Alert severity="error" sx={{ borderRadius: 2 }}>
            {firstError instanceof Error ? firstError.message : 'Failed to load accounts data.'}
          </Alert>
        )}

        <KpiStrip data={summary.data} loading={summary.isLoading} />

        <InTransitStrip data={inTransit.data} loading={inTransit.isLoading} />

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
          summary={summary.data}
        />
      </Stack>
    </Box>
  )
}
