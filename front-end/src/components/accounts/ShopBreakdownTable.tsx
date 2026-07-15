import { useState } from 'react'
import { Box, Button, Card, CardContent, CircularProgress, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { Download } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { AccountsFilters, AccountsShopRowDto, AccountsView } from '../../api/accounts/types'
import { accountsExport } from '../../api/accounts/api'
import { formatINR } from '../../utils/format'

type Props = {
  rows: AccountsShopRowDto[] | undefined
  loading: boolean
  filters: AccountsFilters
}

/**
 * Per-shop breakdown. Default sort = shop name (alphabetical). Clicking a
 * row jumps to the AdminRequests page filtered to that shop + the current
 * date range — the natural drill-down for "which requests made up this row?".
 *
 * Numeric columns use fixed widths (no flex) so a narrow viewport overflows
 * into the DataGrid's horizontal scrollbar instead of squishing the cells;
 * only the Shop name column flexes.
 */
export default function ShopBreakdownTable({ rows, loading, filters }: Props) {
  const navigate = useNavigate()
  const view: AccountsView = filters.view ?? 'all'
  // Excel export typically takes 2-5 seconds (BE renders the .xlsx +
  // streams it). Show a spinner during that window so the admin knows
  // the click registered.
  const [exporting, setExporting] = useState(false)

  // Full column set tagged by which view(s) it belongs to. Filtered before
  // handing to DataGrid so each view shows only its dimensional columns
  // (19-Jun-2026, client #13).
  type ShopCol = GridColDef<AccountsShopRowDto> & { showIn: ReadonlyArray<AccountsView> }
  const ALL: ReadonlyArray<AccountsView> = ['all', 'requested', 'dispatched', 'returns', 'purchased']
  const fmt = (v: unknown) => formatINR(v as number)

  const allColumns: ShopCol[] = [
    { field: 'shopCode',  headerName: 'Code',  width: 90,  showIn: ALL },
    { field: 'shopName',  headerName: 'Shop',  flex: 1, minWidth: 160, showIn: ALL },
    // Counts: Orders count belongs to requested / dispatched / purchased.
    { field: 'orderRequestCount',  headerName: 'Orders',   type: 'number', width: 85,
      showIn: ['all', 'requested', 'dispatched', 'purchased'] },
    { field: 'returnRequestCount', headerName: 'Returns',  type: 'number', width: 85,
      showIn: ['all', 'returns'] },
    // Quantities: physical qty travels with dispatched/purchased (same physical
    // units — the only thing that differs is the amount column's basis).
    { field: 'requestedQty',       headerName: 'Req Qty',      type: 'number', width: 95,
      showIn: ['all', 'requested'] },
    { field: 'dispatchedQty',      headerName: 'Disp Qty',     type: 'number', width: 95,
      showIn: ['all', 'dispatched', 'purchased'] },
    { field: 'returnedQty',        headerName: 'Returned Qty', type: 'number', width: 115,
      showIn: ['all', 'returns'] },
    // Amounts. Purchased (at Cost) leads the money columns per the client
    // ask (12-Jul-2026) — cost before the retail figures.
    { field: 'purchaseAmount',   headerName: 'Purchased (Cost)', type: 'number', width: 150,
      valueFormatter: fmt, showIn: ['all', 'dispatched', 'purchased'] },
    { field: 'requestedAmount',  headerName: 'Requested (MRP)',  type: 'number', width: 150,
      valueFormatter: fmt, showIn: ['all', 'requested'] },
    // Dispatched (MRP) shows in 'purchased' too — the revenue side of the
    // P&L pair. Client needs to see both cost + expected revenue to make
    // sense of the profit/loss column at the end.
    { field: 'dispatchedAmount', headerName: 'Dispatched (MRP)', type: 'number', width: 155,
      valueFormatter: fmt, showIn: ['all', 'dispatched', 'purchased'] },
    { field: 'returnsAmount',    headerName: 'Returns (MRP)',    type: 'number', width: 135,
      valueFormatter: fmt, cellClassName: 'returns-cell',
      showIn: ['all', 'returns'] },
    // Adjustments (MRP) — visible in 'purchased' too since qty edits
    // already flow into both Dispatched (MRP) and Purchased (Cost),
    // and client wants full context for the P&L number.
    { field: 'adjustmentsAmount', headerName: 'Adjustments (MRP)', type: 'number', width: 160,
      valueFormatter: fmt, showIn: ['all', 'dispatched', 'purchased'] },
    // Net (MRP) — visible on 'all' + 'purchased' (needed to explain the
    // Profit/Loss column: P&L = Net − Purchased).
    { field: 'netAmount', headerName: 'Net (MRP)', type: 'number', width: 140,
      valueFormatter: fmt, cellClassName: 'net-cell',
      showIn: ['all', 'purchased'] },
    // Profit / Loss column (12-Jul-2026 client req) — SP returns the pair as
    // two mutually-exclusive columns (exactly one is non-zero per row). We
    // display it as ONE column: green +₹ when profit, red −₹ when loss.
    // Value = profit − loss so DataGrid can sort numerically end-to-end
    // (positive = profit, negative = loss, zero = break-even).
    //
    // Shown on 'all' + 'purchased' (both include cost + revenue, so P&L
    // reconciles). Hidden on the pure-dimension lenses ('requested' /
    // 'dispatched' / 'returns' single-side) which don't have both halves.
    { field: 'profitLoss', headerName: 'Profit / Loss', type: 'number', width: 145,
      showIn: ['all', 'purchased'],
      valueGetter: (_v, row) => (row.profit ?? 0) - (row.loss ?? 0),
      renderCell: ({ row }) => {
        const p = row.profit ?? 0
        const l = row.loss ?? 0
        if (p > 0) return <span style={{ color: '#2E7D32', fontWeight: 700 }}>+{formatINR(p)}</span>
        if (l > 0) return <span style={{ color: '#C62828', fontWeight: 700 }}>−{formatINR(l)}</span>
        return <span style={{ color: '#1F1F1F66' }}>—</span>
      },
    },
  ]
  const columns = allColumns.filter(c => c.showIn.includes(view))

  return (
    <Card sx={{ border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835', background: '#FFFBE6' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>By shop</Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={exporting ? <CircularProgress size={14} thickness={5} sx={{ color: 'inherit' }} /> : <Download size={16} />}
            onClick={async () => {
              if (exporting) return
              setExporting(true)
              try { await accountsExport.byShop(filters) }
              finally { setExporting(false) }
            }}
            disabled={exporting || loading || !rows || rows.length === 0}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            {exporting ? 'Preparing…' : 'Export Excel'}
          </Button>
        </Box>
        <Box sx={{ '& .net-cell': { fontWeight: 700 }, '& .returns-cell': { color: '#C62828' } }}>
          <DataGrid
            className="data-page-grid"
            rows={rows ?? []}
            columns={columns}
            getRowId={(r) => r.shopId}
            loading={loading}
            disableRowSelectionOnClick
            disableColumnMenu
            density="compact"
            autoHeight
            initialState={{
              sorting: { sortModel: [{ field: 'shopName', sort: 'asc' }] },
              pagination: { paginationModel: { pageSize: 25 } },
            }}
            pageSizeOptions={[10, 25, 50, 100]}
            onRowClick={(p) => {
              // Drill-down: open AdminRequests filtered to that shop + range.
              // 19-Jun-2026 (client #13): when an Accounts view-mode is
              // active, also propagate a request-type preset so the
              // destination page shows the SAME slice the user clicked.
              //   • Returns view              → preset=return (Return-type only)
              //   • Requested / Dispatched   → preset=received (Received Orders —
              //                                 the only Orders Accounts counts)
              //   • All view                 → no preset (everything)
              const q = new URLSearchParams()
              q.set('shopId', String(p.row.shopId))
              q.set('from',   filters.from)
              q.set('to',     filters.to)
              if (view === 'returns')                            q.set('preset', 'return')
              else if (view === 'requested' || view === 'dispatched' || view === 'purchased') q.set('preset', 'received')
              navigate(`/admin/requests?${q.toString()}`)
            }}
            sx={{
              border: 'none',
              backgroundColor: 'transparent',
              '& .MuiDataGrid-row': { cursor: 'pointer' },
            }}
          />
        </Box>
      </CardContent>
    </Card>
  )
}
