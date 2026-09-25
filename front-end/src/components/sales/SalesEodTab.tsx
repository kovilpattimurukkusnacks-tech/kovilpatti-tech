import { useState } from 'react'
import { Alert, Box, Chip, CircularProgress, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { useAdminEod, useAdminEodDenominations } from '../../hooks/useAdminPos'
import type { AdminEodSessionDto } from '../../api/admin-pos/types'
import { formatINR } from '../../utils/format'
import { formatIstDateTime, formatIstTime } from '../../utils/formatDate'
import { DetailDialog, Field, GridPaper, SignedMoney } from './salesUi'
import { gridSx, LOSS_RED } from './salesTheme'
import type { SalesFilters } from './SalesFilterBar'

/**
 * Day-end closes (feature #4): per close, the cash the system expected in
 * the till vs what the cashier counted. Negative variance = cash short.
 * Dated by when the close was done.
 */
export default function SalesEodTab({ filters }: { filters: SalesFilters }) {
  const [paging, setPaging] = useState({ page: 0, pageSize: 25 })
  const [varianceOnly, setVarianceOnly] = useState(false)
  const [open, setOpen] = useState<AdminEodSessionDto | null>(null)

  const list = useAdminEod({
    shopId: filters.shopId || undefined,
    from: filters.from,
    to: filters.to,
    varianceOnly,
    page: paging.page + 1,
    pageSize: paging.pageSize,
  })

  const rows = list.data?.items ?? []
  const shortTotal = rows.filter(r => r.variance < 0).reduce((s, r) => s + r.variance, 0)

  const columns: GridColDef<AdminEodSessionDto>[] = [
    { field: 'closedAt', headerName: 'Closed at', width: 165, valueFormatter: v => formatIstDateTime(v as string) },
    { field: 'shopName', headerName: 'Shop', width: 150 },
    { field: 'closedByName', headerName: 'Closed by', width: 140, valueFormatter: v => (v as string) ?? '—' },
    { field: 'windowFrom', headerName: 'Covers', width: 150,
      renderCell: ({ row }) => `${formatIstTime(row.windowFrom)} → ${formatIstTime(row.closedAt)}` },
    { field: 'cashSales', headerName: 'Cash sales', type: 'number', width: 120, valueFormatter: v => formatINR(v as number) },
    { field: 'expectedCash', headerName: 'Expected', type: 'number', width: 120, valueFormatter: v => formatINR(v as number) },
    { field: 'physicalCash', headerName: 'Counted', type: 'number', width: 120,
      renderCell: ({ value }) => <strong>{formatINR(value as number)}</strong> },
    { field: 'variance', headerName: 'Short / Excess', type: 'number', width: 140,
      renderCell: ({ value }) => <SignedMoney value={value as number} /> },
    { field: 'upiSales', headerName: 'UPI', type: 'number', width: 110, valueFormatter: v => formatINR(v as number) },
    { field: 'notes', headerName: 'Notes', flex: 1, minWidth: 140, valueFormatter: v => (v as string) ?? '' },
  ]

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
        <Chip
          label="Only closes that didn't match"
          onClick={() => { setVarianceOnly(v => !v); setPaging(p => ({ ...p, page: 0 })) }}
          color={varianceOnly ? 'warning' : 'default'}
          variant={varianceOnly ? 'filled' : 'outlined'}
          sx={{ fontWeight: 700 }}
        />
        {shortTotal < 0 && (
          <Typography variant="body2" sx={{ fontWeight: 800, color: LOSS_RED }}>
            Shortages on this page: {formatINR(Math.abs(shortTotal))}
          </Typography>
        )}
      </Box>

      {list.isError && <Alert severity="error" sx={{ mb: 2 }}>{list.error instanceof Error ? list.error.message : 'Failed to load day-end closes.'}</Alert>}

      <GridPaper>
        <DataGrid
          rows={rows}
          columns={columns}
          getRowId={r => r.id}
          loading={list.isFetching}
          autoHeight
          disableRowSelectionOnClick
          disableColumnMenu
          paginationMode="server"
          rowCount={list.data?.total ?? 0}
          paginationModel={paging}
          onPaginationModelChange={setPaging}
          pageSizeOptions={[25, 50, 100]}
          onRowClick={p => setOpen(p.row)}
          getRowClassName={p => (p.row.variance < 0 ? 'eod-short' : '')}
          sx={{ ...gridSx, '& .eod-short': { bgcolor: '#FFEBEE' } }}
          localeText={{ noRowsLabel: 'No day-end closes in this period.' }}
        />
      </GridPaper>

      <EodDetailDialog session={open} onClose={() => setOpen(null)} />
    </Box>
  )
}

function EodDetailDialog({ session, onClose }: { session: AdminEodSessionDto | null; onClose: () => void }) {
  const denoms = useAdminEodDenominations(session?.id ?? null)
  const s = session
  return (
    <DetailDialog open={!!s} onClose={onClose} title={s ? `Day-end close — ${s.shopName}` : 'Day-end close'} maxWidth="sm">
      {s && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Closed at">{formatIstDateTime(s.closedAt)}</Field>
            <Field label="Closed by">{s.closedByName ?? '—'}</Field>
            <Field label="Covers from">{formatIstDateTime(s.windowFrom)}</Field>
            <Field label="Short / Excess"><SignedMoney value={s.variance} /></Field>
          </Box>

          <Table size="small">
            <TableBody>
              <Line label="Cash sales" value={s.cashSales} />
              <Line label="Cash refunds (returns)" value={-s.cashRefunds} />
              <Line label="Cash given back (cancelled bills)" value={-s.cancelCashBack} />
              <Line label="Expected cash in till" value={s.expectedCash} bold />
              <Line label="Counted by cashier" value={s.physicalCash} bold />
              <TableRow><TableCell colSpan={2} sx={{ pt: 2, fontWeight: 800, fontSize: 12, textTransform: 'uppercase' }}>Not in the till</TableCell></TableRow>
              <Line label="UPI sales" value={s.upiSales} />
              <Line label="UPI refunds" value={-s.upiRefunds} />
              <Line label="Credit (udhaar) sales" value={s.creditSales} />
            </TableBody>
          </Table>

          <Box>
            <Typography variant="caption" sx={{ textTransform: 'uppercase', fontWeight: 800 }}>Note count</Typography>
            {denoms.isLoading && <Box sx={{ py: 2 }}><CircularProgress size={20} /></Box>}
            {denoms.data && (
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: '#FCD835' }}>
                    <TableCell sx={{ fontWeight: 800 }}>Note</TableCell>
                    <TableCell sx={{ fontWeight: 800 }} align="right">Count</TableCell>
                    <TableCell sx={{ fontWeight: 800 }} align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {denoms.data.filter(d => d.count > 0).map(d => (
                    <TableRow key={d.denomination}>
                      <TableCell>₹{d.denomination}</TableCell>
                      <TableCell align="right">{d.count}</TableCell>
                      <TableCell align="right">{formatINR(d.amount)}</TableCell>
                    </TableRow>
                  ))}
                  {denoms.data.every(d => d.count === 0) && (
                    <TableRow><TableCell colSpan={3} sx={{ opacity: 0.6 }}>No notes counted.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </Box>
          {s.notes && <Field label="Cashier's note">{s.notes}</Field>}
        </Box>
      )}
    </DetailDialog>
  )
}

function Line({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <TableRow>
      <TableCell sx={{ fontWeight: bold ? 800 : 500 }}>{label}</TableCell>
      <TableCell align="right" sx={{ fontWeight: bold ? 800 : 600, color: value < 0 ? LOSS_RED : undefined }}>
        {value < 0 ? '−' : ''}{formatINR(Math.abs(value))}
      </TableCell>
    </TableRow>
  )
}
