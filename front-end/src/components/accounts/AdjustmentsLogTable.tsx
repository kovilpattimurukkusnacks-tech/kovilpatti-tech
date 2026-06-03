import { Box, Button, Card, CardContent, Link as MuiLink, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { Download } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AccountsAdjustmentRowDto, AccountsFilters } from '../../api/accounts/types'
import { accountsExport } from '../../api/accounts/api'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'

type Props = {
  rows: AccountsAdjustmentRowDto[] | undefined
  loading: boolean
  filters: AccountsFilters
}

/**
 * Audit log of qty edits. Posted on `edited_at` (cash-basis) so a row here
 * may correct an Order received weeks ago — the request code links back to
 * the originating request. Δ ₹ uses the line's `unit_price` snapshot, not
 * the product's current MRP, so historical economics stay stable.
 */
export default function AdjustmentsLogTable({ rows, loading, filters }: Props) {
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
    { field: 'deltaQty', headerName: 'Δ Qty', type: 'number', width: 90 },
    {
      field: 'deltaAmount',
      headerName: 'Δ Amount (MRP)',
      type: 'number',
      width: 160,
      valueFormatter: (value) => formatINR(value as number),
      cellClassName: (params) => (params.value as number) < 0 ? 'delta-neg' : (params.value as number) > 0 ? 'delta-pos' : '',
    },
    { field: 'reason',       headerName: 'Reason',     flex: 1, minWidth: 160 },
    { field: 'editedByName', headerName: 'Edited by',  width: 140 },
  ]

  return (
    <Card sx={{ border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Adjustments log</Typography>
            <Typography variant="caption" sx={{ color: '#1F1F1F99' }}>
              Posted on the audit row's <code>edited_at</code> (cash-basis); past period totals stay frozen.
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Download size={16} />}
            onClick={() => accountsExport.adjustments(filters)}
            disabled={loading || !rows || rows.length === 0}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Export CSV
          </Button>
        </Box>
        <Box sx={{
          '& .delta-pos': { color: '#2E7D32', fontWeight: 700 },
          '& .delta-neg': { color: '#C62828', fontWeight: 700 },
        }}>
          <DataGrid
            rows={rows ?? []}
            columns={cols}
            getRowId={(r) => r.auditId}
            loading={loading}
            disableRowSelectionOnClick
            density="compact"
            autoHeight
            initialState={{
              sorting: { sortModel: [{ field: 'editedAt', sort: 'desc' }] },
              pagination: { paginationModel: { pageSize: 25 } },
            }}
            pageSizeOptions={[10, 25, 50, 100]}
            sx={{ border: 'none' }}
          />
        </Box>
      </CardContent>
    </Card>
  )
}
