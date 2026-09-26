import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box } from '@mui/material'
import PageHeader from '../../components/PageHeader'
import { FilterPanel, type FilterPill } from '../../components/FilterBar'
import SalesFilterBar, { type SalesFilters } from '../../components/sales/SalesFilterBar'
import SalesOverview from '../../components/sales/SalesOverview'
import SalesBillsTab from '../../components/sales/SalesBillsTab'
import SalesReturnsTab from '../../components/sales/SalesReturnsTab'
import SalesEodTab from '../../components/sales/SalesEodTab'
import SalesCustomersTab from '../../components/sales/SalesCustomersTab'
import { SegmentedTabs } from '../../components/sales/salesUi'
import { useShops } from '../../hooks/useShops'
import { istDate, istFirstOfThisMonth } from '../../utils/istDate'

type TabKey = 'overview' | 'bills' | 'returns' | 'eod' | 'customers'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview',  label: 'Overview' },
  { key: 'bills',     label: 'Bills' },
  { key: 'returns',   label: 'Returns & cancellations' },
  { key: 'eod',       label: 'Day-end closes' },
  { key: 'customers', label: 'Credit customers' },
]

const isYmd = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${d}/${m}/${y}`
}

/**
 * Admin → Sales (Phase 4d). The owner's view over POS billing across every
 * shop: sales overview, every bill, cancellations + refunds, day-end cash
 * closes and outstanding udhaar. Read-only — shop staff still bill, return,
 * cancel and close the day from /shop/billing.
 *
 * Tab + date range + shop live in the URL so a refresh or a shared link
 * keeps the view. Default range: this month (IST).
 */
export default function AdminSales() {
  const [params, setParams] = useSearchParams()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const shops = useShops().data ?? []

  const tab = (TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'overview') as TabKey
  const filters: SalesFilters = {
    from: isYmd(params.get('from')) ? params.get('from')! : istFirstOfThisMonth(),
    to: isYmd(params.get('to')) ? params.get('to')! : istDate(),
    shopId: params.get('shop') ?? '',
  }
  // A shop id in the URL that no longer exists (deleted shop, old link)
  // silently falls back to "All shops" instead of an empty page.
  if (filters.shopId && shops.length > 0 && !shops.some(s => s.id === filters.shopId)) filters.shopId = ''

  const update = (patch: Partial<SalesFilters> & { tab?: TabKey }) => {
    const next = new URLSearchParams(params)
    const merged = { ...filters, tab, ...patch }
    next.set('tab', merged.tab)
    next.set('from', merged.from)
    next.set('to', merged.to)
    if (merged.shopId) next.set('shop', merged.shopId); else next.delete('shop')
    setParams(next, { replace: true })
  }

  const shopName = shops.find(s => s.id === filters.shopId)?.name
  const pills = useMemo<FilterPill[]>(() => {
    const p: FilterPill[] = []
    if (tab !== 'customers') {
      p.push({ key: 'range', label: filters.from === filters.to ? fmtDate(filters.from) : `${fmtDate(filters.from)} – ${fmtDate(filters.to)}` })
    }
    if (filters.shopId) p.push({ key: 'shop', label: shopName ?? 'Shop', onRemove: () => update({ shopId: '' }) })
    return p
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filters.from, filters.to, filters.shopId, shopName])

  // Remount the tab when the page filters change so its paging resets to 1.
  const filterKey = `${filters.from}|${filters.to}|${filters.shopId}`

  return (
    <div>
      <PageHeader
        title="Sales"
        subtitle="POS billing across all shops — sales, bills, refunds, day-end cash and udhaar"
      />

      <Box sx={{ mb: 2 }}>
        <SegmentedTabs<TabKey> value={tab} options={TABS} onChange={k => update({ tab: k })} />
      </Box>

      <FilterPanel open={filtersOpen} onToggle={() => setFiltersOpen(o => !o)} pills={pills}>
        <SalesFilterBar filters={filters} onChange={f => update(f)} />
      </FilterPanel>

      {tab === 'overview'  && <SalesOverview filters={filters} onShopClick={id => update({ shopId: id })} />}
      {tab === 'bills'     && <SalesBillsTab filters={filters} />}
      {tab === 'returns'   && <SalesReturnsTab key={filterKey} filters={filters} />}
      {tab === 'eod'       && <SalesEodTab key={filterKey} filters={filters} />}
      {tab === 'customers' && <SalesCustomersTab key={filters.shopId} shopId={filters.shopId} />}
    </div>
  )
}
