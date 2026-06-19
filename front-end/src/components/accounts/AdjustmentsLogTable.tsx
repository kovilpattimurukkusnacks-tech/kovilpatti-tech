import { useMemo, useState } from 'react'
import { Box, Button, Card, CardContent, CircularProgress, Link as MuiLink, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { Download } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import type { AccountsAdjustmentRowDto, AccountsFilters, AccountsSummaryDto } from '../../api/accounts/types'
import { accountsExport } from '../../api/accounts/api'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'

type Props = {
  rows: AccountsAdjustmentRowDto[] | undefined
  loading: boolean
  filters: AccountsFilters
  /** Page-level summary — supplies the edits total for the header line.
   *  Already fetched by AdminAccounts; no extra request. */
  summary: AccountsSummaryDto | undefined
}

/**
 * Audit log of qty edits, anchored on `edited_at` — a row here may correct
 * an Order received weeks ago; the request code links back to the
 * originating request. Amounts use the line's `unit_price` snapshot, not
 * the product's current MRP, so historical economics stay stable.
 *
 * This table is also the home of the edits TOTAL (header line). There is
 * deliberately no Adjustments KPI card: edits already flow into the live
 * Dispatched/Net figures, so a peer-level card reads as money to add.
 */
export default function AdjustmentsLogTable({ rows, loading, filters, summary }: Props) {
  const navigate = useNavigate()
  // Excel export typically takes 2-5 seconds — spinner during BE render.
  const [exporting, setExporting] = useState(false)

  // 19-Jun-2026 (client #13): view-mode lens filter — keep audits whose
  // request_type matches the active view. The summary KPI (count + net
  // effect) is recomputed from the visible rows so the header line stays
  // honest. 'all' / 'dispatched' show Order audits + Return audits both
  // for now (dispatched lens conceptually covers Order-side audits, but
  // returns lens conceptually covers Return-side audits — we keep both
  // visible in 'dispatched' since it's the closest to the historical
  // "Adjustments" semantic; clients can refine later if needed).
  const view = filters.view ?? 'all'
  const visibleRows = useMemo(() => {
    if (!rows) return [] as AccountsAdjustmentRowDto[]
    if (view === 'returns')    return rows.filter(r => r.requestType === 'Return')
    if (view === 'dispatched') return rows.filter(r => r.requestType === 'Order')
    // 'all' (and 'requested' — but the parent doesn't render the table in
    // that view anyway) show every audit.
    return rows
  }, [rows, view])

  // Recompute summary from the visible rows so the count / net-effect
  // header matches what's actually rendered. When view='all' this still
  // matches summary.adjustmentsCount / summary.adjustmentsAmount.
  const visibleCount  = visibleRows.length
  const visibleAmount = visibleRows.reduce((acc, r) => acc + r.deltaAmount, 0)

  const cols: GridColDef<AccountsAdjustmentRowDto>[] = [
    {
      field: 'editedAt',
      headerName: 'Edited at',
      width: 160,
      valueFormatter: (value) => formatIstDateTime(value as string),
    },
    {
      field: 'requestCode',
      headerName: 'Request',
      width: 110,
      renderCell: (params) => (
        <MuiLink
          component={Link}
          to={`/admin/requests/${params.row.requestId}`}
          underline="hover"
          sx={{ fontWeight: 700, color: '#1F1F1F' }}
          onClick={(e) => e.stopPropagation()}
        >
          {params.value as string}
        </MuiLink>
      ),
    },
    { field: 'shopName',     headerName: 'Shop',    flex: 1, minWidth: 140 },
    { field: 'productName',  headerName: 'Product', flex: 1.2, minWidth: 180 },
    {
      field: 'weight',
      headerName: 'Pack',
      width: 90,
      sortable: false,
      valueGetter: (_v, row) =>
        row.weightValue != null ? `${row.weightValue} ${row.weightUnit ?? ''}`.trim() : '',
    },
    {
      field: 'change',
      headerName: 'Old → New',
      width: 130,
      sortable: false,
      valueGetter: (_v, row) => `${row.oldQty ?? '—'} → ${row.newQty ?? '—'}`,
    },
    { field: 'deltaQty', headerName: 'Qty', type: 'number', width: 90 },
    {
      field: 'deltaAmount',
      headerName: 'Amount (MRP)',
      type: 'number',
      width: 150,
      valueFormatter: (value) => formatINR(value as number),
      cellClassName: (params) => (params.value as number) < 0 ? 'delta-neg' : (params.value as number) > 0 ? 'delta-pos' : '',
    },
    { field: 'reason',       headerName: 'Reason',     flex: 1, minWidth: 160 },
    { field: 'editedByName', headerName: 'Edited by',  width: 140 },
  ]

  return (
    <Card sx={{ border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835', background: '#FFFBE6' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Adjustments log</Typography>
            <Typography variant="caption" sx={{ color: '#1F1F1F99' }}>
              {summary
                ? <>{visibleCount} edit{visibleCount === 1 ? '' : 's'} · net effect <strong>{formatINR(visibleAmount)}</strong> — already included in the totals above</>
                : 'Qty edits in this period — already included in the totals above'}
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            startIcon={exporting ? <CircularProgress size={14} thickness={5} sx={{ color: 'inherit' }} /> : <Download size={16} />}
            onClick={async () => {
              if (exporting) return
              setExporting(true)
              try { await accountsExport.adjustments(filters) }
              finally { setExporting(false) }
            }}
            disabled={exporting || loading || visibleRows.length === 0}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            {exporting ? 'Preparing…' : 'Export Excel'}
          </Button>
        </Box>
        <Box sx={{
          '& .delta-pos': { color: '#2E7D32', fontWeight: 700 },
          '& .delta-neg': { color: '#C62828', fontWeight: 700 },
        }}>
          <DataGrid
            className="data-page-grid"
            rows={visibleRows}
            columns={cols}
            getRowId={(r) => r.auditId}
            loading={loading}
            disableRowSelectionOnClick
            disableColumnMenu
            density="compact"
            autoHeight
            initialState={{
              sorting: { sortModel: [{ field: 'editedAt', sort: 'desc' }] },
              pagination: { paginationModel: { pageSize: 25 } },
            }}
            pageSizeOptions={[10, 25, 50, 100]}
            onRowClick={(p) => navigate(`/admin/requests/${p.row.requestId}`)}
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
