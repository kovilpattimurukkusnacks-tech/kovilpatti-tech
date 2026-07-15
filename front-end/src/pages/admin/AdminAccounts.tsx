import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Box, Button, Stack } from '@mui/material'
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
  useAccountsUtilities,
  useAccountsTopProducts,
} from '../../hooks/useAccounts'
import type { AccountsFilters, AccountsGrouping, AccountsTopProductsLimit, AccountsView } from '../../api/accounts/types'

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
    // View / lens (19-Jun-2026, client #13). Defaults to 'all'.
    const viewRaw = params.get('view')
    const view: AccountsView =
      viewRaw === 'requested' || viewRaw === 'dispatched' || viewRaw === 'returns' || viewRaw === 'purchased'
        ? viewRaw
        : 'all'
    return {
      from,
      to,
      grouping,
      shopIds:     shopIds && shopIds.length > 0 ? shopIds : undefined,
      categoryIds: categoryIds && categoryIds.length > 0 ? categoryIds : undefined,
      limit: [10, 25, 50].includes(limit) ? limit : 10,
      view,
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
      // View — omit URL key when 'all' (default) to keep links clean.
      if (next.view && next.view !== 'all') out.set('view', next.view); else out.delete('view')
      return out
    }, { replace: true })
  }, [setParams])

  /** Convenience setter so the tab onClick stays one-liner. */
  const setView = useCallback((view: AccountsView) => {
    setFilters({ ...filters, view })
  }, [filters, setFilters])

  const setTopProductsLimit = useCallback((n: AccountsTopProductsLimit) => {
    setFilters({ ...filters, limit: n })
  }, [filters, setFilters])

  // Active-filter pills shown while the panel is collapsed. The date pill has
  // no ✕ — the range always applies (defaults to this month) and is changed
  // via the expanded panel. Shop pills show the NAME and their ✕ removes
  // just that shop. Category filter is intentionally NOT a global pill —
  // it lives inside the By-Category / Top-Products table and only scopes
  // those two queries (see scopedFilters / nonCategoryFilters below).
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

  // Category filter is intentionally local to the By-Category / Top-Products
  // table — strip it from the filter object handed to the other 4 queries
  // so the KPIs / Shop breakdown / Adjustments log reflect the whole
  // catalogue regardless of what the table is filtered to.
  const nonCategoryFilters = useMemo(
    () => ({ ...filters, categoryIds: undefined }),
    [filters],
  )

  // Queries — every section drives its own request so a single slow SP
  // doesn't block the rest of the page from rendering.
  const summary     = useAccountsSummary(nonCategoryFilters)
  const inTransit   = useAccountsInTransit(nonCategoryFilters)
  const byShop      = useAccountsByShop(nonCategoryFilters)
  const byCategory  = useAccountsByCategory(filters)
  const topProducts = useAccountsTopProducts(filters)
  const adjustments = useAccountsAdjustments(nonCategoryFilters)
  // Shop expenses (15-Jul-2026) — drives the Net Profit KPI, the Shop
  // Expenses card + tooltip, and the Shop Expenses column in the by-shop
  // table. Uses the same non-category filter set (utility categories are
  // a separate taxonomy from product categories).
  const utilities   = useAccountsUtilities(nonCategoryFilters)

  // Surface the first error encountered. Validation failures on the BE
  // (e.g. range > 366 days) come back as ApiError 400.
  const firstError = summary.error || inTransit.error || byShop.error
                   || byCategory.error || topProducts.error || adjustments.error
                   || utilities.error

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Accounts"
        subtitle="Stock-movement value (at MRP), by date range. Read-only."
      />

      <Stack spacing={2} sx={{ mt: 2 }}>
        {/* View / lens tabs (19-Jun-2026, client #13). Switches the dashboard
            between All / Requested / Dispatched / Returns. FE-only filter —
            BE returns all dimensions, FE hides cards / columns based on
            the active view. Cache stays warm across switches. */}
        <ViewTabs current={filters.view ?? 'all'} onChange={setView} />

        <FilterPanel open={filtersOpen} onToggle={() => setFiltersOpen(o => !o)} pills={activePills}>
          <AccountsFilterBar filters={filters} activePresetKey={activePresetKey} onChange={setFilters} />
        </FilterPanel>

        {firstError && (
          <Alert severity="error" sx={{ borderRadius: 2 }}>
            {firstError instanceof Error ? firstError.message : 'Failed to load accounts data.'}
          </Alert>
        )}

        <KpiStrip
          data={summary.data}
          loading={summary.isLoading || utilities.isLoading}
          view={filters.view}
          utilityRows={utilities.data}
        />

        {/* In-Transit: order-side metric (dispatched but not yet received).
            Doesn't apply when the user is focused on Returns view — hide. */}
        {filters.view !== 'returns' && (
          <InTransitStrip data={inTransit.data} loading={inTransit.isLoading} />
        )}

        <ShopBreakdownTable
          rows={byShop.data}
          loading={byShop.isLoading}
          filters={filters}
          utilityRows={utilities.data}
        />

        <CategoryAndProductsTable
          categoryRows={byCategory.data}
          topProductRows={topProducts.data}
          loadingCategories={byCategory.isLoading}
          loadingProducts={topProducts.isLoading}
          filters={filters}
          topProductsLimit={(filters.limit ?? 10) as AccountsTopProductsLimit}
          onTopProductsLimitChange={setTopProductsLimit}
          categories={categoriesData ?? []}
          selectedCategoryIds={filters.categoryIds ?? []}
          onCategoryIdsChange={(ids) =>
            setFilters({ ...filters, categoryIds: ids.length ? ids : undefined })
          }
        />

        {/* Adjustments log: hidden ONLY in Requested view (pre-finalization,
            no audits exist yet). Shown in All / Dispatched / Returns /
            Purchased since qty edits can happen on either an Order's
            dispatched_qty OR a Return's accepted_qty after the request is
            finalized — both flow into the same stock_request_qty_audits
            table. Under Purchased view they're especially relevant since
            an edit up/down changes the row's Profit/Loss result. */}
        {filters.view !== 'requested' && (
          <AdjustmentsLogTable
            rows={adjustments.data}
            loading={adjustments.isLoading}
            filters={filters}
            summary={summary.data}
          />
        )}
      </Stack>
    </Box>
  )
}

// ───────────────────────────────────────────────────────────────
// ViewTabs — segmented control rendered as MUI Buttons (not Tabs).
// Using Buttons over the Tabs component because:
//   1. Gold gradient matches the existing preset-button pattern, so
//      the page has one consistent active-button look.
//   2. No underline / indicator state to manage.
//   3. Easier mobile wrap behaviour.
//
// active = gold gradient (theme primary). inactive = white pill.
// ───────────────────────────────────────────────────────────────
function ViewTabs({ current, onChange }: {
  current: AccountsView
  onChange: (v: AccountsView) => void
}) {
  const options: { key: AccountsView; label: string }[] = [
    { key: 'all',         label: 'All Activity' },
    { key: 'requested',   label: 'Requested' },
    { key: 'dispatched',  label: 'Dispatched' },
    { key: 'returns',     label: 'Returns' },
    // 12-Jul-2026 (client req) — cost-basis lens. Same rows as dispatched
    // but pivots the amount column to purchase_price_snapshot.
    { key: 'purchased',   label: 'Purchased' },
  ]
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
      {options.map(o => {
        const active = current === o.key
        return (
          <Button
            key={o.key}
            size="small"
            disableElevation
            variant={active ? 'contained' : 'outlined'}
            onClick={() => onChange(o.key)}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 999,
              px: 2,
              ...(active ? {} : { bgcolor: '#FFFBE6', color: '#1F1F1F', borderColor: 'rgba(31,31,31,0.25)' }),
            }}
          >
            {o.label}
          </Button>
        )
      })}
    </Box>
  )
}
