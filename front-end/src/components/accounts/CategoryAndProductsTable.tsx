import { useState } from 'react'
import { Box, Button, Card, CardContent, MenuItem, Tab, Tabs, TextField } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { Download } from 'lucide-react'
import type {
  AccountsCategoryRowDto,
  AccountsFilters,
  AccountsProductRowDto,
  AccountsTopProductsLimit,
} from '../../api/accounts/types'
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
}

/**
 * Tabbed component with two views:
 *   1. By category — one row per leaf category referenced by the filtered
 *      requests. Quantity / Amount are signed (Returns subtract) so the
 *      Net here matches the page-level Net KPI.
 *   2. Top products — top N by Amount. N selector is part of the URL state.
 *
 * Each tab has its own Export CSV button.
 */
export default function CategoryAndProductsTable({
  categoryRows, topProductRows,
  loadingCategories, loadingProducts,
  filters,
  topProductsLimit, onTopProductsLimitChange,
}: Props) {
  const [tab, setTab] = useState<'category' | 'top-products'>('category')

  const catCols: GridColDef<AccountsCategoryRowDto>[] = [
    { field: 'categoryPath', headerName: 'Category', flex: 1.5, minWidth: 220 },
    { field: 'quantity',     headerName: 'Quantity', type: 'number', width: 130 },
    {
      field: 'amount',
      headerName: 'Amount (MRP)',
      type: 'number',
      width: 160,
      valueFormatter: (value) => formatINR(value as number),
      cellClassName: 'amount-cell',
    },
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
    { field: 'quantity', headerName: 'Quantity', type: 'number', width: 110 },
    {
      field: 'amount',
      headerName: 'Amount (MRP)',
      type: 'number',
      width: 160,
      valueFormatter: (value) => formatINR(value as number),
      cellClassName: 'amount-cell',
    },
  ]

  return (
    <Card sx={{ border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835', background: '#FFFBE6' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v as 'category' | 'top-products')}
            sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, fontWeight: 700, textTransform: 'none' } }}
          >
            <Tab label="By category" value="category" />
            <Tab label="Top products" value="top-products" />
          </Tabs>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
              startIcon={<Download size={16} />}
              onClick={() =>
                tab === 'category'
                  ? accountsExport.byCategory(filters)
                  : accountsExport.topProducts(filters)
              }
              disabled={
                tab === 'category'
                  ? loadingCategories || !categoryRows || categoryRows.length === 0
                  : loadingProducts   || !topProductRows || topProductRows.length === 0
              }
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Export CSV
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
