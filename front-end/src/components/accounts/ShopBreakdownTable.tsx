import { Box, Button, Card, CardContent, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { Download } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { AccountsFilters, AccountsShopRowDto } from '../../api/accounts/types'
import { accountsExport } from '../../api/accounts/api'
import { formatINR } from '../../utils/format'

type Props = {
  rows: AccountsShopRowDto[] | undefined
  loading: boolean
  filters: AccountsFilters
}

/**
 * Per-shop breakdown. Default sort = Net descending. Clicking a row jumps
 * to the AdminRequests page filtered to that shop + the current date
 * range — the natural drill-down for "which requests made up this row?".
 */
export default function ShopBreakdownTable({ rows, loading, filters }: Props) {
  const navigate = useNavigate()

  const columns: GridColDef<AccountsShopRowDto>[] = [
    { field: 'shopCode',  headerName: 'Code',  width: 90 },
    { field: 'shopName',  headerName: 'Shop',  flex: 1.2, minWidth: 180 },
    { field: 'orderRequestCount',  headerName: 'Orders',  type: 'number', width: 90 },
    { field: 'returnRequestCount', headerName: 'Returns', type: 'number', width: 90 },
    { field: 'dispatchedQty',      headerName: 'Disp Qty', type: 'number', width: 100 },
    {
      field: 'dispatchedAmount',
      headerName: 'Dispatched (MRP)',
      type: 'number',
      width: 160,
      valueFormatter: (value) => formatINR(value as number),
    },
    {
      field: 'returnsAmount',
      headerName: 'Returns (MRP)',
      type: 'number',
      width: 140,
      valueFormatter: (value) => formatINR(value as number),
      cellClassName: 'returns-cell',
    },
    {
      field: 'netAmount',
      headerName: 'Net (MRP)',
      type: 'number',
      width: 140,
      valueFormatter: (value) => formatINR(value as number),
      cellClassName: 'net-cell',
    },
  ]

  return (
    <Card sx={{ border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>By shop</Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Download size={16} />}
            onClick={() => accountsExport.byShop(filters)}
            disabled={loading || !rows || rows.length === 0}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Export CSV
          </Button>
        </Box>
        <Box sx={{ '& .net-cell': { fontWeight: 700 }, '& .returns-cell': { color: '#C62828' } }}>
          <DataGrid
            rows={rows ?? []}
            columns={columns}
            getRowId={(r) => r.shopId}
            loading={loading}
            disableRowSelectionOnClick
            density="compact"
            autoHeight
            initialState={{
              sorting: { sortModel: [{ field: 'netAmount', sort: 'desc' }] },
              pagination: { paginationModel: { pageSize: 25 } },
            }}
            pageSizeOptions={[10, 25, 50, 100]}
            onRowClick={(p) => {
              // Drill-down: open AdminRequests filtered to that shop + range.
              const q = new URLSearchParams()
              q.set('shopId', String(p.row.shopId))
              q.set('from',   filters.from)
              q.set('to',     filters.to)
              navigate(`/admin/requests?${q.toString()}`)
            }}
            sx={{
              border: 'none',
              '& .MuiDataGrid-row': { cursor: 'pointer' },
            }}
          />
        </Box>
      </CardContent>
    </Card>
  )
}
