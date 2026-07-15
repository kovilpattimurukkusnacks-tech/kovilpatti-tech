import { useState } from 'react'
import { Autocomplete, Box, Button, Card, CardContent, Chip, CircularProgress, MenuItem, Tab, Tabs, TextField } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { CornerDownRight, Download } from 'lucide-react'
import type {
  AccountsCategoryRowDto,
  AccountsFilters,
  AccountsProductRowDto,
  AccountsTopProductsLimit,
  AccountsView,
} from '../../api/accounts/types'
import type { CategoryDto } from '../../api/categories/types'
import { accountsExport } from '../../api/accounts/api'
import { formatINR } from '../../utils/format'

type Props = {
  categoryRows: AccountsCategoryRowDto[] | undefined
  topProductRows: AccountsProductRowDto[] | undefined
  loadingCategories: boolean
  loadingProducts: boolean
  filters: AccountsFilters
  /** Top-N selector value (10 / 25 / 50). Owned by the parent so URL state
   *  can include it. */
  topProductsLimit: AccountsTopProductsLimit
  onTopProductsLimitChange: (n: AccountsTopProductsLimit) => void
  /** Category catalogue for the local filter; from useCategories(). */
  categories: CategoryDto[]
  /** Local-to-this-card category filter — applies to BOTH tabs (by-category
   *  + top-products). KPIs / shop breakdown / adjustments are unaffected
   *  (the parent strips this dimension before handing them their filters). */
  selectedCategoryIds: number[]
  onCategoryIdsChange: (ids: number[]) => void
}

/**
 * Tabbed component with two views:
 *   1. By category — one row per leaf category referenced by the filtered
 *      requests. Quantity / Amount are signed (Returns subtract) so the
 *      Net here matches the page-level Net KPI.
 *   2. Top products — top N by Amount. N selector is part of the URL state.
 *
 * Each tab has its own Export Excel button.
 */
export default function CategoryAndProductsTable({
  categoryRows, topProductRows,
  loadingCategories, loadingProducts,
  filters,
  topProductsLimit, onTopProductsLimitChange,
  categories, selectedCategoryIds, onCategoryIdsChange,
}: Props) {
  const [tab, setTab] = useState<'category' | 'top-products'>('category')
  // Excel export typically takes 2-5 seconds — spinner gives the admin
  // immediate feedback that the click registered.
  const [exporting, setExporting] = useState(false)

  // Resolve the selected ids to full CategoryDto objects for the Autocomplete
  // `value` prop. The parent's `selectedCategoryIds` is the source of truth
  // (URL-backed via filters.categoryIds).
  const selectedCategories = categories.filter(c => selectedCategoryIds.includes(c.id))

  // 19-Jun-2026 (client #13): when the page is in a view-mode lens, the
  // Category & Top-Products tables render per-dim numbers instead of Net.
  // The BE already returns all dims in the same payload (additive SP change)
  // so we can switch on view without a refetch — cache stays warm.
  const view: AccountsView = filters.view ?? 'all'

  const qtyLabel    = view === 'all'        ? 'Quantity (Net)'
                    : view === 'requested'  ? 'Requested Qty'
                    : view === 'dispatched' ? 'Dispatched Qty'
                    : view === 'purchased'  ? 'Dispatched Qty'   // physical qty = same as dispatched
                    :                         'Returned Qty'
  const amtLabel    = view === 'all'        ? 'Amount (MRP Net)'
                    : view === 'requested'  ? 'Requested (MRP)'
                    : view === 'dispatched' ? 'Dispatched (MRP)'
                    : view === 'purchased'  ? 'Purchased (Cost)' // cost basis pivot
                    :                         'Returns (MRP)'
  // Field-resolution helpers — pick the right numeric column per view.
  // 'purchased' uses the same physical qty as 'dispatched' (units are units)
  // but pivots the amount to purchaseAmount so the row reads at cost basis.
  const catQty = (r: AccountsCategoryRowDto) =>
    view === 'requested'  ? r.requestedQty
  : view === 'dispatched' ? r.dispatchedQty
  : view === 'purchased'  ? r.dispatchedQty
  : view === 'returns'    ? r.returnsQty
  :                         r.quantity
  const catAmt = (r: AccountsCategoryRowDto) =>
    view === 'requested'  ? r.requestedAmount
  : view === 'dispatched' ? r.dispatchedAmount
  : view === 'purchased'  ? r.purchaseAmount
  : view === 'returns'    ? r.returnsAmount
  :                         r.amount
  // Products fall back to dispatched under 'purchased' (top-products DTO
  // doesn't carry purchaseAmount yet — BE follow-up if the client asks
  // for per-product cost). Physical qty stays the same either way.
  const prodQty = (r: AccountsProductRowDto) =>
    view === 'requested'  ? r.requestedQty
  : view === 'dispatched' ? r.dispatchedQty
  : view === 'purchased'  ? r.dispatchedQty
  : view === 'returns'    ? r.returnsQty
  :                         r.quantity
  const prodAmt = (r: AccountsProductRowDto) =>
    view === 'requested'  ? r.requestedAmount
  : view === 'dispatched' ? r.dispatchedAmount
  : view === 'purchased'  ? r.dispatchedAmount
  : view === 'returns'    ? r.returnsAmount
  :                         r.amount

  const catCols: GridColDef<AccountsCategoryRowDto>[] = [
    { field: 'categoryPath', headerName: 'Category', flex: 1.5, minWidth: 220 },
    {
      field: 'quantity',
      headerName: qtyLabel,
      type: 'number',
      width: 150,
      // valueGetter so the grid's sort + Excel-paste both see the active dim.
      valueGetter: (_v, row) => catQty(row),
    },
    {
      field: 'amount',
      headerName: amtLabel,
      type: 'number',
      width: 170,
      valueGetter: (_v, row) => catAmt(row),
      valueFormatter: (value) => formatINR(value as number),
      cellClassName: 'amount-cell',
    },
    // Profit / Loss column (12-Jul-2026 client req) — matches ShopBreakdownTable.
    // SP returns the pair as two mutually-exclusive columns (exactly one is
    // non-zero per category). Shown here as ONE column: green +₹ profit,
    // red −₹ loss. Shown on 'all' + 'purchased' (both have cost + revenue,
    // so P&L reconciles). Hidden on pure-dim lenses.
    ...(view === 'all' || view === 'purchased' ? [{
      field: 'profitLoss',
      headerName: 'Profit / Loss',
      type: 'number' as const,
      width: 145,
      valueGetter: (_v: unknown, row: AccountsCategoryRowDto) => (row.profit ?? 0) - (row.loss ?? 0),
      renderCell: ({ row }: { row: AccountsCategoryRowDto }) => {
        const p = row.profit ?? 0
        const l = row.loss ?? 0
        if (p > 0) return <span style={{ color: '#2E7D32', fontWeight: 700 }}>+{formatINR(p)}</span>
        if (l > 0) return <span style={{ color: '#C62828', fontWeight: 700 }}>−{formatINR(l)}</span>
        return <span style={{ color: '#1F1F1F66' }}>—</span>
      },
    } satisfies GridColDef<AccountsCategoryRowDto>] : []),
  ]

  const prodCols: GridColDef<AccountsProductRowDto>[] = [
    { field: 'productCode', headerName: 'Code', width: 90 },
    { field: 'productName', headerName: 'Product', flex: 1.4, minWidth: 220 },
    {
      field: 'weight',
      headerName: 'Pack',
      width: 90,
      sortable: false,
      valueGetter: (_v, row) =>
        row.weightValue != null ? `${row.weightValue} ${row.weightUnit ?? ''}`.trim() : '',
    },
    {
      field: 'quantity',
      headerName: qtyLabel,
      type: 'number',
      width: 140,
      valueGetter: (_v, row) => prodQty(row),
    },
    {
      field: 'amount',
      headerName: amtLabel,
      type: 'number',
      width: 170,
      valueGetter: (_v, row) => prodAmt(row),
      valueFormatter: (value) => formatINR(value as number),
      cellClassName: 'amount-cell',
    },
  ]

  return (
    <Card sx={{ border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835', background: '#FFFBE6' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 1 }}>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v as 'category' | 'top-products')}
            sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, fontWeight: 700, textTransform: 'none' } }}
          >
            <Tab label="By category" value="category" />
            <Tab label="Top products" value="top-products" />
          </Tabs>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', flex: 1, justifyContent: 'flex-end' }}>
            {/* Card-scoped category filter — applies to both tabs. Tree-style
                option render (CornerDownRight icon + depth indent) so nested
                categories read naturally; full breadcrumb path is the
                getOptionLabel so typing "biscuits > brit" finds the leaf. */}
            <Autocomplete
              multiple
              size="small"
              options={categories}
              value={selectedCategories}
              getOptionLabel={(o) => o.path ?? o.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              onChange={(_, vals) => onCategoryIdsChange(vals.map(v => v.id))}
              renderInput={(params) => <TextField {...params} label="Categories" />}
              renderOption={(props, option) => {
                const { key, ...liProps } = props as React.HTMLAttributes<HTMLLIElement> & { key?: React.Key }
                return (
                  <li key={key} {...liProps} style={{ ...(liProps.style as object), paddingLeft: 8 + option.depth * 16 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      {option.depth > 0 && (
                        <CornerDownRight
                          className="w-3.5 h-3.5"
                          style={{ color: 'rgba(31,31,31,0.55)', flexShrink: 0 }}
                        />
                      )}
                      <span>{option.name}</span>
                    </Box>
                  </li>
                )
              }}
              renderValue={(value, getItemProps) =>
                value.map((option, index) => {
                  const { key, ...itemProps } = getItemProps({ index })
                  return <Chip key={key} size="small" label={option.name} title={option.path ?? option.name} {...itemProps} />
                })
              }
              sx={{ minWidth: 240, maxWidth: 420, flex: 1 }}
            />
            {tab === 'top-products' && (
              <TextField
                select
                size="small"
                label="Top N"
                value={topProductsLimit}
                onChange={(e) => onTopProductsLimitChange(Number(e.target.value) as AccountsTopProductsLimit)}
                sx={{ width: 90 }}
              >
                {[10, 25, 50].map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}
              </TextField>
            )}
            <Button
              size="small"
              variant="outlined"
              startIcon={exporting ? <CircularProgress size={14} thickness={5} sx={{ color: 'inherit' }} /> : <Download size={16} />}
              onClick={async () => {
                if (exporting) return
                setExporting(true)
                try {
                  await (tab === 'category'
                    ? accountsExport.byCategory(filters)
                    : accountsExport.topProducts(filters))
                } finally {
                  setExporting(false)
                }
              }}
              disabled={
                exporting || (
                  tab === 'category'
                    ? loadingCategories || !categoryRows || categoryRows.length === 0
                    : loadingProducts   || !topProductRows || topProductRows.length === 0
                )
              }
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              {exporting ? 'Preparing…' : 'Export Excel'}
            </Button>
          </Box>
        </Box>

        <Box sx={{ '& .amount-cell': { fontWeight: 700 } }}>
          {tab === 'category' ? (
            <DataGrid
              className="data-page-grid"
              rows={categoryRows ?? []}
              columns={catCols}
              getRowId={(r) => r.categoryId}
              loading={loadingCategories}
              disableRowSelectionOnClick
              disableColumnMenu
              density="compact"
              autoHeight
              pageSizeOptions={[10, 25, 50]}
              initialState={{
                // Alphabetical by path so related categories group together.
                sorting: { sortModel: [{ field: 'categoryPath', sort: 'asc' }] },
                pagination: { paginationModel: { pageSize: 25 } },
              }}
              sx={{ border: 'none', backgroundColor: 'transparent' }}
            />
          ) : (
            <DataGrid
              className="data-page-grid"
              rows={topProductRows ?? []}
              columns={prodCols}
              getRowId={(r) => r.productId}
              loading={loadingProducts}
              disableRowSelectionOnClick
              disableColumnMenu
              density="compact"
              autoHeight
              pageSizeOptions={[10, 25, 50]}
              initialState={{
                sorting: { sortModel: [{ field: 'amount', sort: 'desc' }] },
                pagination: { paginationModel: { pageSize: 25 } },
              }}
              sx={{ border: 'none', backgroundColor: 'transparent' }}
            />
          )}
        </Box>
      </CardContent>
    </Card>
  )
}
