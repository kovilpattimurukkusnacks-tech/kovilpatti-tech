import { Alert, Box, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import {
  useAdminSalesByShop, useAdminSalesDaily, useAdminSalesSummary, useAdminSalesTopProducts,
} from '../../hooks/useAdminPos'
import type {
  AdminSalesDayRowDto, AdminSalesProductRowDto, AdminSalesShopRowDto,
} from '../../api/admin-pos/types'
import { formatINR } from '../../utils/format'
import { formatWeightG } from '../../utils/formatDispatched'
import { GridPaper, SectionTitle, StatCard } from './salesUi'
import { CREAM, gridSx, LOSS_RED } from './salesTheme'
import type { SalesFilters } from './SalesFilterBar'

const money = (v: unknown) => formatINR(v as number)

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC',
  })
}

/**
 * Sales overview (feature #5). Bills are dated by when they were issued,
 * returns by when they were processed. "Sales" = bills still Issued (after
 * discount); "Net" = sales − returns. The by-shop table always spans every
 * shop (so idle shops show as zero); the shop filter narrows the KPIs,
 * daily table and best sellers.
 */
export default function SalesOverview({ filters, onShopClick }: {
  filters: SalesFilters
  onShopClick: (shopId: string) => void
}) {
  const range = { from: filters.from, to: filters.to, shopId: filters.shopId || undefined }
  const summary = useAdminSalesSummary(range)
  const byShop  = useAdminSalesByShop(range, !filters.shopId)
  const daily   = useAdminSalesDaily(range)
  const top     = useAdminSalesTopProducts(range)

  const s = summary.data
  const loading = summary.isLoading
  const error = [summary, byShop, daily, top].find(q => q.isError)?.error

  const shopCols: GridColDef<AdminSalesShopRowDto>[] = [
    { field: 'shopCode', headerName: 'Code', width: 90 },
    { field: 'shopName', headerName: 'Shop', flex: 1, minWidth: 150 },
    { field: 'billCount', headerName: 'Bills', type: 'number', width: 80 },
    { field: 'salesTotal', headerName: 'Sales', type: 'number', width: 130, valueFormatter: money },
    { field: 'returnsTotal', headerName: 'Returns', type: 'number', width: 120, valueFormatter: money,
      cellClassName: 'returns-cell' },
    { field: 'netSales', headerName: 'Net', type: 'number', width: 135, valueFormatter: money,
      cellClassName: 'net-cell' },
    { field: 'cashSales', headerName: 'Cash', type: 'number', width: 120, valueFormatter: money },
    { field: 'upiSales', headerName: 'UPI', type: 'number', width: 120, valueFormatter: money },
    { field: 'creditSales', headerName: 'Credit', type: 'number', width: 120, valueFormatter: money },
    { field: 'discountTotal', headerName: 'Discounts', type: 'number', width: 115, valueFormatter: money },
    { field: 'cancelledCount', headerName: 'Cancelled', type: 'number', width: 100,
      renderCell: ({ row }) => row.cancelledCount > 0
        ? <span style={{ color: LOSS_RED, fontWeight: 700 }}>{row.cancelledCount} · {formatINR(row.cancelledAmount)}</span>
        : <span style={{ opacity: 0.4 }}>—</span> },
  ]

  const dayCols: GridColDef<AdminSalesDayRowDto>[] = [
    { field: 'day', headerName: 'Day', width: 140, valueFormatter: v => formatDay(v as string) },
    { field: 'billCount', headerName: 'Bills', type: 'number', width: 80 },
    { field: 'salesTotal', headerName: 'Sales', type: 'number', width: 130, valueFormatter: money },
    { field: 'returnsTotal', headerName: 'Returns', type: 'number', width: 120, valueFormatter: money,
      cellClassName: 'returns-cell' },
    { field: 'netSales', headerName: 'Net', type: 'number', width: 135, valueFormatter: money, cellClassName: 'net-cell' },
    { field: 'cashSales', headerName: 'Cash', type: 'number', width: 120, valueFormatter: money },
    { field: 'upiSales', headerName: 'UPI', type: 'number', width: 120, valueFormatter: money },
    { field: 'creditSales', headerName: 'Credit', type: 'number', width: 120, valueFormatter: money },
    { field: 'cancelledCount', headerName: 'Cancelled', type: 'number', width: 100 },
  ]

  const productCols: GridColDef<AdminSalesProductRowDto>[] = [
    { field: 'productCode', headerName: 'Code', width: 90 },
    { field: 'productName', headerName: 'Product', flex: 1, minWidth: 180 },
    { field: 'categoryName', headerName: 'Category', width: 150 },
    { field: 'packetsSold', headerName: 'Packets', type: 'number', width: 95 },
    { field: 'looseWeightG', headerName: 'Loose', type: 'number', width: 100,
      valueFormatter: v => (v as number) > 0 ? formatWeightG(v as number) : '—' },
    { field: 'billCount', headerName: 'Bills', type: 'number', width: 80 },
    { field: 'revenue', headerName: 'Revenue', type: 'number', width: 130, valueFormatter: money, cellClassName: 'net-cell' },
  ]

  const tableSx = {
    ...gridSx,
    '& .MuiDataGrid-row': { cursor: 'default' },
    '& .net-cell': { fontWeight: 800 },
    '& .returns-cell': { color: LOSS_RED },
  }

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error instanceof Error ? error.message : 'Failed to load sales.'}</Alert>}

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' } }}>
        <StatCard label="Net sales" value={s?.netSales} loading={loading} tone="gold"
          secondary="sales − returns" />
        <StatCard label="Sales" value={s?.salesTotal} loading={loading}
          secondary={s ? `${s.billCount} bill${s.billCount === 1 ? '' : 's'} · avg ${formatINR(s.avgBillValue)}` : undefined} />
        <StatCard label="Returns" value={s?.returnsTotal} loading={loading} tone="red"
          secondary={s ? `${s.returnCount} return${s.returnCount === 1 ? '' : 's'}` : undefined} />
        <StatCard label="Cancelled" value={s?.cancelledAmount} loading={loading} tone="red"
          secondary={s ? `${s.cancelledCount} bill${s.cancelledCount === 1 ? '' : 's'}` : undefined} />
        <StatCard label="Discounts given" value={s?.discountTotal} loading={loading}
          secondary={s ? `on ${formatINR(s.grossSales)} gross` : undefined} />
        <StatCard label="Udhaar given" value={s?.creditSales} loading={loading}
          secondary={s ? `collected back ${formatINR(s.settlementsCash + s.settlementsUpi)}` : undefined} />
      </Box>

      {/* How the money came in — the owner's "where is the cash" view. */}
      <GridPaper sx={{ mt: 2, p: 2 }}>
        <Typography variant="caption" sx={{ textTransform: 'uppercase', fontWeight: 800, letterSpacing: 1 }}>
          Collections (cash in hand vs bank)
        </Typography>
        <Box sx={{ display: 'grid', gap: 1.5, mt: 1, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
          <MoneyLine label="Cash" parts={s ? [
            ['Sales', s.cashSales], ['Udhaar repaid', s.settlementsCash], ['Refunds', -s.cashRefunds],
          ] : null} />
          <MoneyLine label="UPI" parts={s ? [
            ['Sales', s.upiSales], ['Udhaar repaid', s.settlementsUpi], ['Refunds', -s.upiRefunds],
          ] : null} />
          <MoneyLine label="Credit (udhaar)" parts={s ? [
            ['Given on bills', s.creditSales], ['Repaid', -(s.settlementsCash + s.settlementsUpi)],
          ] : null} />
        </Box>
      </GridPaper>

      {!filters.shopId && (
        <>
          <SectionTitle>By shop</SectionTitle>
          <GridPaper>
            <DataGrid
              rows={byShop.data ?? []}
              columns={shopCols}
              getRowId={r => r.shopId}
              loading={byShop.isLoading}
              autoHeight
              hideFooter
              disableRowSelectionOnClick
              disableColumnMenu
              onRowClick={p => onShopClick(p.row.shopId)}
              sx={{ ...tableSx, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
            />
          </GridPaper>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.75, opacity: 0.7 }}>
            Click a shop to see only that shop.
          </Typography>
        </>
      )}

      <SectionTitle>Day by day</SectionTitle>
      <GridPaper>
        <DataGrid
          rows={daily.data ?? []}
          columns={dayCols}
          getRowId={r => r.day}
          loading={daily.isLoading}
          autoHeight
          disableRowSelectionOnClick
          disableColumnMenu
          initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
          pageSizeOptions={[10, 31]}
          sx={tableSx}
        />
      </GridPaper>

      <SectionTitle>Best sellers</SectionTitle>
      <GridPaper>
        <DataGrid
          rows={top.data ?? []}
          columns={productCols}
          getRowId={r => r.productId}
          loading={top.isLoading}
          autoHeight
          hideFooter
          disableRowSelectionOnClick
          disableColumnMenu
          sx={tableSx}
          localeText={{ noRowsLabel: 'No sales in this period.' }}
        />
      </GridPaper>
      <Typography variant="caption" sx={{ display: 'block', mt: 0.75, opacity: 0.7 }}>
        Top 20 by revenue, before bill discounts and returns.
      </Typography>
    </Box>
  )
}

function MoneyLine({ label, parts }: { label: string; parts: [string, number][] | null }) {
  const total = parts?.reduce((sum, [, v]) => sum + v, 0)
  return (
    <Box sx={{ border: '1.5px solid rgba(31,31,31,0.2)', borderRadius: 2, p: 1.5, bgcolor: CREAM }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
        <span>{label}</span>
        <span>{total == null ? '—' : formatINR(total)}</span>
      </Box>
      {parts?.map(([name, v]) => (
        <Box key={name} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, opacity: 0.8, mt: 0.25 }}>
          <span>{name}</span>
          <span style={{ color: v < 0 ? LOSS_RED : undefined }}>{v < 0 ? '−' : ''}{formatINR(Math.abs(v))}</span>
        </Box>
      ))}
    </Box>
  )
}
