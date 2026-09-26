import { useState } from 'react'
import { Alert, Box, Button, CircularProgress, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { Undo2, XCircle } from 'lucide-react'
import { useAdminBill } from '../../hooks/useAdminPos'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import { formatWeightG } from '../../utils/formatDispatched'
import { BillStatusChip, DetailDialog, Field } from './salesUi'
import { LOSS_RED } from './salesTheme'
import AdminCancelBillDialog from './AdminCancelBillDialog'
import ReturnBillDialog from '../billing/ReturnBillDialog'

const CANCEL_REASON: Record<string, string> = {
  Mistake: 'Billing mistake', Duplicate: 'Duplicate bill', CustomerRefused: 'Customer refused', Other: 'Other',
}

/** Admin bill detail. Opened from the Bills / Cancellations tabs.
 *  25-Sep-2026: Issued bills get the admin overrides — cancel (any cashier,
 *  closed days) and return items (past the shop's return window). */
export default function BillDetailDialog({ billId, onClose }: { billId: string | null; onClose: () => void }) {
  const q = useAdminBill(billId)
  const b = q.data
  const [cancelOpen, setCancelOpen] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnedCode, setReturnedCode] = useState<string | null>(null)

  const close = () => { setReturnedCode(null); onClose() }

  return (
    <DetailDialog
      open={!!billId}
      onClose={close}
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

          {returnedCode && (
            <Alert severity="success" onClose={() => setReturnedCode(null)}>
              Return <strong>{returnedCode}</strong> saved.
            </Alert>
          )}

          {b.status === 'Issued' && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                size="small" variant="outlined"
                startIcon={<Undo2 className="w-3.5 h-3.5" />}
                onClick={() => { setReturnedCode(null); setReturnOpen(true) }}
                sx={{ textTransform: 'none', fontWeight: 700, color: '#1F1F1F', borderColor: '#1F1F1F' }}
              >
                Return items
              </Button>
              <Button
                size="small" variant="outlined" color="error"
                startIcon={<XCircle className="w-3.5 h-3.5" />}
                disabled={b.returns.length > 0}
                title={b.returns.length > 0 ? 'This bill has a return — return the remaining items instead.' : undefined}
                onClick={() => setCancelOpen(true)}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                Cancel bill
              </Button>
              <Box sx={{ fontSize: 12, color: '#1F1F1F99', alignSelf: 'center' }}>
                Admin override — for bills the shop can no longer cancel or return itself.
              </Box>
            </Box>
          )}

          {b.status === 'Cancelled' && (
            <Alert severity="warning" sx={{ '& .MuiAlert-message': { width: '100%' } }}>
              <strong>Cancelled</strong> {formatIstDateTime(b.cancelledAt)} by {b.cancelledByName ?? '—'}
              {b.cancelReasonType && <> · {CANCEL_REASON[b.cancelReasonType] ?? b.cancelReasonType}</>}
              {b.cancelReason && <>{b.cancelReasonType ? ' — ' : ' · '}“{b.cancelReason}”</>}
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

      <AdminCancelBillDialog
        bill={cancelOpen && b ? { id: b.id, code: b.code } : null}
        onClose={() => setCancelOpen(false)}
      />
      <ReturnBillDialog
        admin
        billId={returnOpen && b ? b.id : null}
        billCode={b?.code ?? null}
        onClose={() => setReturnOpen(false)}
        onDone={code => { setReturnOpen(false); setReturnedCode(code) }}
      />
    </DetailDialog>
  )
}
