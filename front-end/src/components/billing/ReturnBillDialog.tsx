import { useMemo, useState } from 'react'
import { Banknote, Minus, Plus, Smartphone, Undo2 } from 'lucide-react'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, TextField,
} from '@mui/material'
import { formatINR } from '../../utils/format'
import { useReturnableItems, useCreateBillReturn } from '../../hooks/useBills'
import type { RefundMode, ReturnReasonType } from '../../api/bills/types'

// ───────────────────────────────────────────────────────────────
// Return Bill (feature #1). Cash/UPI refund, partial + full. Cashier
// picks how many of each line to return (capped at billed − already
// returned); returned goods go back on the shelf server-side.
// ───────────────────────────────────────────────────────────────

const REASONS: { value: ReturnReasonType; label: string }[] = [
  { value: 'Damaged', label: 'Damaged' },
  { value: 'WrongItem', label: 'Wrong item' },
  { value: 'ChangedMind', label: 'Changed mind' },
  { value: 'Other', label: 'Other' },
]

export default function ReturnBillDialog({
  billId, billCode, onClose, onDone,
}: {
  billId: string | null
  billCode: string | null
  onClose: () => void
  onDone: (returnCode: string) => void
}) {
  const query = useReturnableItems(billId ?? undefined)
  const createReturn = useCreateBillReturn()

  // productId → qty to return this time.
  const [qtys, setQtys] = useState<Record<string, number>>({})
  const [refundMode, setRefundMode] = useState<RefundMode>('Cash')
  const [reasonType, setReasonType] = useState<ReturnReasonType>('Damaged')
  const [reasonNote, setReasonNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const items = useMemo(() => query.data ?? [], [query.data])

  const setQty = (productId: string, max: number, next: number) => {
    setError(null)
    const clamped = Math.max(0, Math.min(next, max))
    setQtys(prev => ({ ...prev, [productId]: clamped }))
  }

  const refundTotal = items.reduce(
    (s, it) => s + (qtys[it.productId] ?? 0) * it.unitPrice, 0)
  const selectedCount = items.reduce((s, it) => s + ((qtys[it.productId] ?? 0) > 0 ? 1 : 0), 0)
  const nothingReturnable = items.length > 0 && items.every(it => it.returnableQty <= 0)

  const handleSubmit = () => {
    if (!billId) return
    const lines = items
      .filter(it => (qtys[it.productId] ?? 0) > 0)
      .map(it => ({ productId: it.productId, qty: qtys[it.productId] }))
    if (lines.length === 0) {
      setError('Choose at least one item and quantity to return.')
      return
    }
    setError(null)
    createReturn.mutate(
      {
        sourceBillId: billId,
        refundMode,
        reasonType,
        reasonNote: reasonNote.trim() || null,
        items: lines,
      },
      {
        onSuccess: created => {
          setQtys({}); setReasonNote(''); setRefundMode('Cash'); setReasonType('Damaged')
          onDone(created.code)
        },
        onError: err => setError(err instanceof Error ? err.message : 'Failed to save the return.'),
      },
    )
  }

  const handleClose = () => {
    setQtys({}); setReasonNote(''); setRefundMode('Cash'); setReasonType('Damaged'); setError(null)
    onClose()
  }

  return (
    <Dialog open={!!billId} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Undo2 className="w-5 h-5 text-[#C62828]" />
        Return items {billCode ? `· bill ${billCode}` : ''}
      </DialogTitle>
      <DialogContent dividers>
        {query.isLoading && <Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress size={24} /></Box>}
        {query.isError && (
          <Alert severity="error">
            {query.error instanceof Error ? query.error.message : 'Failed to load the bill.'}
          </Alert>
        )}

        {!query.isLoading && !query.isError && (
          <>
            {nothingReturnable && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Every item on this bill has already been returned.
              </Alert>
            )}
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {items.map(it => {
                const returnable = it.returnableQty
                const qty = qtys[it.productId] ?? 0
                const disabled = returnable <= 0
                return (
                  <Box
                    key={it.productId}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1,
                      p: 1.5, borderRadius: 2,
                      border: '1px solid rgba(31,31,31,0.15)',
                      bgcolor: disabled ? '#F5F5F5' : '#FFFBE6',
                      opacity: disabled ? 0.6 : 1,
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>{it.productName}</Box>
                      <Box sx={{ fontSize: 11, color: '#1F1F1F99' }}>
                        {formatINR(it.unitPrice)} each · billed {it.billedQty}
                        {it.returnedQty > 0 ? ` · ${it.returnedQty} returned` : ''}
                        {disabled ? '' : ` · up to ${returnable}`}
                      </Box>
                    </Box>
                    {disabled ? (
                      <Box sx={{ fontSize: 12, fontWeight: 700, color: '#C62828' }}>Fully returned</Box>
                    ) : (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <IconButton size="small" onClick={() => setQty(it.productId, returnable, qty - 1)} aria-label="Decrease">
                          <Minus className="w-3.5 h-3.5" />
                        </IconButton>
                        <Box sx={{ fontWeight: 700, minWidth: 24, textAlign: 'center' }}>{qty}</Box>
                        <IconButton size="small" onClick={() => setQty(it.productId, returnable, qty + 1)} aria-label="Increase">
                          <Plus className="w-3.5 h-3.5" />
                        </IconButton>
                      </Box>
                    )}
                  </Box>
                )
              })}
            </Box>

            {/* Refund mode — Cash / UPI. */}
            <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
              {([
                { mode: 'Cash' as const, icon: <Banknote className="w-4 h-4" /> },
                { mode: 'UPI' as const, icon: <Smartphone className="w-4 h-4" /> },
              ]).map(({ mode, icon }) => {
                const active = refundMode === mode
                return (
                  <Button
                    key={mode}
                    fullWidth
                    disableElevation
                    variant={active ? 'contained' : 'outlined'}
                    startIcon={icon}
                    onClick={() => setRefundMode(mode)}
                    sx={{
                      textTransform: 'none', fontWeight: 700,
                      ...(active
                        ? { background: 'linear-gradient(90deg, #C28A00 0%, #E6B800 35%, #FFD700 65%, #FFF1A6 100%)', color: '#1F1F1F' }
                        : { color: '#1F1F1F', borderColor: 'rgba(31,31,31,0.35)' }),
                    }}
                  >
                    Refund by {mode}
                  </Button>
                )
              })}
            </Box>

            <TextField
              select
              fullWidth
              label="Reason"
              value={reasonType}
              onChange={e => setReasonType(e.target.value as ReturnReasonType)}
              sx={{ mt: 2 }}
            >
              {REASONS.map(r => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
            </TextField>

            <TextField
              fullWidth
              multiline
              minRows={2}
              label="Note (optional)"
              value={reasonNote}
              onChange={e => setReasonNote(e.target.value)}
              sx={{ mt: 2 }}
              inputProps={{ maxLength: 500 }}
            />
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Box sx={{ fontSize: 14, fontWeight: 800 }}>
          Refund: {formatINR(refundTotal)}
          {selectedCount > 0 ? <Box component="span" sx={{ fontSize: 12, fontWeight: 600, color: '#1F1F1F99', ml: 1 }}>({selectedCount} {selectedCount === 1 ? 'item' : 'items'})</Box> : null}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={handleClose} sx={{ textTransform: 'none', fontWeight: 700 }}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={refundTotal <= 0 || createReturn.isPending || nothingReturnable}
            onClick={handleSubmit}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {createReturn.isPending ? 'Saving…' : 'Confirm Return'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}
