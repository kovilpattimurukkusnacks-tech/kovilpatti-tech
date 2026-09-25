import { Alert, Box, CircularProgress, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useAdminBill } from '../../hooks/useAdminPos'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import { formatWeightG } from '../../utils/formatDispatched'
import { BillStatusChip, DetailDialog, Field } from './salesUi'
import { LOSS_RED } from './salesTheme'

const CANCEL_REASON: Record<string, string> = {
  Mistake: 'Billing mistake', Duplicate: 'Duplicate bill', CustomerRefused: 'Customer refused', Other: 'Other',
}

/** Admin bill detail — read-only. Opened from the Bills / Cancellations tabs. */
export default function BillDetailDialog({ billId, onClose }: { billId: string | null; onClose: () => void }) {
  const q = useAdminBill(billId)
  const b = q.data

  return (
    <DetailDialog
      open={!!billId}
      onClose={onClose}
      title={b ? <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>{b.code} <BillStatusChip status={b.status} /></Box> : 'Bill'}
    >
      {q.isLoading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={28} /></Box>}
      {q.isError && <Alert severity="error">{q.error instanceof Error ? q.error.message : 'Failed to load bill.'}</Alert>}
      {b && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
            <Field label="Shop">{b.shopCode} — {b.shopName}</Field>
            <Field label="Billed at">{formatIstDateTime(b.createdAt)}</Field>
            <Field label="Cashier">{b.createdByName ?? '—'}</Field>
            <Field label="Customer">
              {b.customerName ? `${b.customerName} (${b.customerPhone})` : 'Walk-in'}
            </Field>
          </Box>

          {b.status === 'Cancelled' && (
            <Alert severity="warning" sx={{ '& .MuiAlert-message': { width: '100%' } }}>
              <strong>Cancelled</strong> {formatIstDateTime(b.cancelledAt)} by {b.cancelledByName ?? '—'} ·{' '}
              {CANCEL_REASON[b.cancelReasonType ?? ''] ?? b.cancelReasonType}
              {b.cancelReason ? ` — “${b.cancelReason}”` : ''}
            </Alert>
          )}

          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FCD835' }}>
                <TableCell sx={{ fontWeight: 800 }}>Product</TableCell>
                <TableCell sx={{ fontWeight: 800 }} align="right">Qty</TableCell>
                <TableCell sx={{ fontWeight: 800 }} align="right">MRP</TableCell>
                <TableCell sx={{ fontWeight: 800 }} align="right">Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {b.items.map(i => (
                <TableRow key={i.id}>
                  <TableCell>{i.productCode} · {i.productName}</TableCell>
                  <TableCell align="right">
                    {i.qty != null ? i.qty : i.looseWeightG != null ? `${formatWeightG(i.looseWeightG)} loose` : '—'}
                  </TableCell>
                  <TableCell align="right">{formatINR(i.unitPrice)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{formatINR(i.lineTotal)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={3} align="right">Subtotal</TableCell>
                <TableCell align="right">{formatINR(b.subtotal)}</TableCell>
              </TableRow>
              {b.discountAmount > 0 && (
                <TableRow>
                  <TableCell colSpan={3} align="right">
                    Discount{b.discountKind === 'Percent' ? ` (${b.discountValue}%)` : ''}
                  </TableCell>
                  <TableCell align="right" sx={{ color: LOSS_RED }}>−{formatINR(b.discountAmount)}</TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell colSpan={3} align="right" sx={{ fontWeight: 800 }}>Total</TableCell>
                <TableCell align="right" sx={{ fontWeight: 800 }}>{formatINR(b.totalAmount)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <Box>
            <Typography variant="caption" sx={{ textTransform: 'uppercase', fontWeight: 800 }}>Paid by</Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 0.5 }}>
              {b.payments.map(p => (
                <Box key={p.id} sx={{ fontWeight: 700 }}>{p.mode === 'Credit' ? 'Credit (udhaar)' : p.mode}: {formatINR(p.amount)}</Box>
              ))}
            </Box>
          </Box>

          {b.returns.length > 0 && (
            <Box>
              <Typography variant="caption" sx={{ textTransform: 'uppercase', fontWeight: 800 }}>Returns on this bill</Typography>
              <Table size="small" sx={{ mt: 0.5 }}>
                <TableBody>
                  {b.returns.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>{r.code}</TableCell>
                      <TableCell>{formatIstDateTime(r.createdAt)}</TableCell>
                      <TableCell>{r.reasonType}{r.reasonNote ? ` — ${r.reasonNote}` : ''}</TableCell>
                      <TableCell>{r.refundMode} refund · {r.createdByName ?? '—'}</TableCell>
                      <TableCell align="right" sx={{ color: LOSS_RED, fontWeight: 700 }}>−{formatINR(r.totalAmount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}

          {b.notes && <Field label="Notes">{b.notes}</Field>}
        </Box>
      )}
    </DetailDialog>
  )
}
