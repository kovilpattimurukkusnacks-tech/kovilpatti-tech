import { useState } from 'react'
import { Alert, Box, CircularProgress, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { useAdminBills, useAdminReturn, useAdminReturns } from '../../hooks/useAdminPos'
import type { AdminBillListItemDto, AdminBillReturnListItemDto } from '../../api/admin-pos/types'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import { DetailDialog, Field, GridPaper, SectionTitle } from './salesUi'
import { gridSx, LOSS_RED } from './salesTheme'
import BillDetailDialog from './BillDetailDialog'
import type { SalesFilters } from './SalesFilterBar'

const CANCEL_REASON: Record<string, string> = {
  Mistake: 'Billing mistake', Duplicate: 'Duplicate bill', CustomerRefused: 'Customer refused', Other: 'Other',
}
const RETURN_REASON: Record<string, string> = {
  Damaged: 'Damaged', WrongItem: 'Wrong item', ChangedMind: 'Changed mind', Other: 'Other',
}

/**
 * Cancellations + refunds audit (feature #7): who cancelled or refunded
 * what, when and why. Cancelled bills are dated by the bill date (same as
 * the Bills tab); returns by when the refund was given.
 */
export default function SalesReturnsTab({ filters }: { filters: SalesFilters }) {
  const [cancelPaging, setCancelPaging] = useState({ page: 0, pageSize: 10 })
  const [returnPaging, setReturnPaging] = useState({ page: 0, pageSize: 10 })
  const [billId, setBillId] = useState<string | null>(null)
  const [returnId, setReturnId] = useState<string | null>(null)

  const shopId = filters.shopId || undefined
  const cancelled = useAdminBills({
    shopId, from: filters.from, to: filters.to, status: 'Cancelled',
    page: cancelPaging.page + 1, pageSize: cancelPaging.pageSize,
  })
  const returns = useAdminReturns({
    shopId, from: filters.from, to: filters.to,
    page: returnPaging.page + 1, pageSize: returnPaging.pageSize,
  })

  const cancelCols: GridColDef<AdminBillListItemDto>[] = [
    { field: 'code', headerName: 'Bill', width: 110 },
    { field: 'shopName', headerName: 'Shop', width: 140 },
    { field: 'totalAmount', headerName: 'Amount', type: 'number', width: 115, valueFormatter: v => formatINR(v as number) },
    { field: 'paymentMode', headerName: 'Was paid by', width: 110 },
    { field: 'createdAt', headerName: 'Billed at', width: 160, valueFormatter: v => formatIstDateTime(v as string) },
    { field: 'cancelledAt', headerName: 'Cancelled at', width: 160, valueFormatter: v => formatIstDateTime(v as string) },
    { field: 'cancelledByName', headerName: 'Cancelled by', width: 140, valueFormatter: v => (v as string) ?? '—' },
    { field: 'cancelReasonType', headerName: 'Reason', flex: 1, minWidth: 200,
      renderCell: ({ row }) => (
        <span>
          <strong>{CANCEL_REASON[row.cancelReasonType ?? ''] ?? row.cancelReasonType ?? '—'}</strong>
          {row.cancelReason ? ` — ${row.cancelReason}` : ''}
        </span>
      ) },
  ]

  const returnCols: GridColDef<AdminBillReturnListItemDto>[] = [
    { field: 'code', headerName: 'Return', width: 100 },
    { field: 'sourceBillCode', headerName: 'Bill', width: 110 },
    { field: 'shopName', headerName: 'Shop', width: 140 },
    { field: 'createdAt', headerName: 'Refunded at', width: 160, valueFormatter: v => formatIstDateTime(v as string) },
    { field: 'createdByName', headerName: 'By', width: 140, valueFormatter: v => (v as string) ?? '—' },
    { field: 'refundMode', headerName: 'Refund', width: 90 },
    { field: 'totalQty', headerName: 'Qty', type: 'number', width: 70 },
    { field: 'totalAmount', headerName: 'Amount', type: 'number', width: 115,
      renderCell: ({ value }) => <span style={{ color: LOSS_RED, fontWeight: 800 }}>−{formatINR(value as number)}</span> },
    { field: 'reasonType', headerName: 'Reason', flex: 1, minWidth: 180,
      renderCell: ({ row }) => (
        <span><strong>{RETURN_REASON[row.reasonType] ?? row.reasonType}</strong>{row.reasonNote ? ` — ${row.reasonNote}` : ''}</span>
      ) },
  ]

  const err = cancelled.error ?? returns.error

  return (
    <Box>
      {err && <Alert severity="error" sx={{ mb: 2 }}>{err instanceof Error ? err.message : 'Failed to load.'}</Alert>}

      <SectionTitle right={<Typography variant="body2" sx={{ fontWeight: 700 }}>{cancelled.data?.total ?? 0} cancelled</Typography>}>
        Cancelled bills
      </SectionTitle>
      <GridPaper>
        <DataGrid
          rows={cancelled.data?.items ?? []}
          columns={cancelCols}
          getRowId={r => r.id}
          loading={cancelled.isFetching}
          autoHeight
          disableRowSelectionOnClick
          disableColumnMenu
          paginationMode="server"
          rowCount={cancelled.data?.total ?? 0}
          paginationModel={cancelPaging}
          onPaginationModelChange={setCancelPaging}
          pageSizeOptions={[10, 25, 50]}
          onRowClick={p => setBillId(p.row.id)}
          sx={gridSx}
          localeText={{ noRowsLabel: 'No cancelled bills in this period.' }}
        />
      </GridPaper>

      <SectionTitle right={<Typography variant="body2" sx={{ fontWeight: 700 }}>{returns.data?.total ?? 0} returns</Typography>}>
        Returns &amp; refunds
      </SectionTitle>
      <GridPaper>
        <DataGrid
          rows={returns.data?.items ?? []}
          columns={returnCols}
          getRowId={r => r.id}
          loading={returns.isFetching}
          autoHeight
          disableRowSelectionOnClick
          disableColumnMenu
          paginationMode="server"
          rowCount={returns.data?.total ?? 0}
          paginationModel={returnPaging}
          onPaginationModelChange={setReturnPaging}
          pageSizeOptions={[10, 25, 50]}
          onRowClick={p => setReturnId(p.row.id)}
          sx={gridSx}
          localeText={{ noRowsLabel: 'No returns in this period.' }}
        />
      </GridPaper>

      <BillDetailDialog billId={billId} onClose={() => setBillId(null)} />
      <ReturnDetailDialog
        returnId={returnId}
        onClose={() => setReturnId(null)}
        onOpenBill={id => { setReturnId(null); setBillId(id) }}
      />
    </Box>
  )
}

function ReturnDetailDialog({ returnId, onClose, onOpenBill }: {
  returnId: string | null
  onClose: () => void
  onOpenBill: (billId: string) => void
}) {
  const q = useAdminReturn(returnId)
  const r = q.data
  return (
    <DetailDialog open={!!returnId} onClose={onClose} title={r ? `Return ${r.code}` : 'Return'} maxWidth="sm">
      {q.isLoading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={28} /></Box>}
      {q.isError && <Alert severity="error">{q.error instanceof Error ? q.error.message : 'Failed to load return.'}</Alert>}
      {r && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Shop">{r.shopCode} — {r.shopName}</Field>
            <Field label="Against bill">
              <Box component="button" type="button" onClick={() => onOpenBill(r.sourceBillId)}
                sx={{ fontWeight: 800, textDecoration: 'underline', cursor: 'pointer', background: 'none', border: 0, p: 0, color: 'inherit', font: 'inherit' }}>
                {r.sourceBillCode}
              </Box>
            </Field>
            <Field label="Refunded at">{formatIstDateTime(r.createdAt)}</Field>
            <Field label="By">{r.createdByName ?? '—'}</Field>
            <Field label="Refund">{r.refundMode}</Field>
            <Field label="Reason">{RETURN_REASON[r.reasonType] ?? r.reasonType}{r.reasonNote ? ` — ${r.reasonNote}` : ''}</Field>
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FCD835' }}>
                <TableCell sx={{ fontWeight: 800 }}>Product</TableCell>
                <TableCell sx={{ fontWeight: 800 }} align="right">Qty</TableCell>
                <TableCell sx={{ fontWeight: 800 }} align="right">Price</TableCell>
                <TableCell sx={{ fontWeight: 800 }} align="right">Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {r.items.map(i => (
                <TableRow key={i.id}>
                  <TableCell>{i.productCode} · {i.productName}</TableCell>
                  <TableCell align="right">{i.qty}</TableCell>
                  <TableCell align="right">{formatINR(i.unitPrice)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{formatINR(i.lineTotal)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={3} align="right" sx={{ fontWeight: 800 }}>Refunded</TableCell>
                <TableCell align="right" sx={{ fontWeight: 800, color: LOSS_RED }}>{formatINR(r.totalAmount)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Box>
      )}
    </DetailDialog>
  )
}
