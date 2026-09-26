import { useMemo, useState, type ReactNode } from 'react'
import { Banknote, Minus, NotebookPen, Plus, Smartphone, Undo2 } from 'lucide-react'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, TextField,
} from '@mui/material'
import { formatINR } from '../../utils/format'
import { useReturnableItems, useCreateBillReturn, useRefundOptions } from '../../hooks/useBills'
import { useAdminCreateReturn, useAdminRefundOptions, useAdminReturnableItems } from '../../hooks/useAdminPos'
import type { RefundMode, ReturnReasonType } from '../../api/bills/types'

// ───────────────────────────────────────────────────────────────
// Return Bill (feature #1). Partial + full. Cashier picks how many of each
// line to return (capped at billed − already returned); returned goods go
// back on the shelf server-side (Damaged ones are written off).
//
// 25-Sep-2026:
//   • Refund goes back the way the bill was paid — only the bill's own
//     tender modes are offered (Credit = reduces the customer's udhaar).
//   • The refund is the discounted price (refundUnitPrice), not MRP.
//   • Reason "Other" needs a note.
//   • `admin` = the admin override (past the shop's return window); same
//     dialog, admin endpoints.
// ───────────────────────────────────────────────────────────────

const REASONS: { value: ReturnReasonType; label: string }[] = [
  { value: 'Damaged', label: 'Damaged' },
  { value: 'WrongItem', label: 'Wrong item' },
  { value: 'ChangedMind', label: 'Changed mind' },
  { value: 'Other', label: 'Other' },
]

const MODE_META: Record<RefundMode, { label: string; icon: ReactNode }> = {
  Cash:   { label: 'Refund by Cash',       icon: <Banknote className="w-4 h-4" /> },
  UPI:    { label: 'Refund by UPI',        icon: <Smartphone className="w-4 h-4" /> },
  Credit: { label: 'Reduce udhaar',        icon: <NotebookPen className="w-4 h-4" /> },
}

const round2 = (n: number) => Math.round(n * 100) / 100

export default function ReturnBillDialog({
  billId, billCode, onClose, onDone, admin = false,
}: {
  billId: string | null
  billCode: string | null
  onClose: () => void
  onDone: (returnCode: string) => void
  admin?: boolean
}) {
  const id = billId ?? undefined
  // Hooks can't be conditional — the unused pair stays disabled (id undefined).
  const shopItems   = useReturnableItems(admin ? undefined : id)
  const adminItems  = useAdminReturnableItems(admin ? id : undefined)
  const shopOpts    = useRefundOptions(admin ? undefined : id)
  const adminOpts   = useAdminRefundOptions(admin ? id : undefined)
  const shopCreate  = useCreateBillReturn()
  const adminCreate = useAdminCreateReturn()
  const query        = admin ? adminItems : shopItems
  const optionsQuery = admin ? adminOpts : shopOpts
  const createReturn = admin ? adminCreate : shopCreate

  // productId → qty to return this time.
  const [qtys, setQtys] = useState<Record<string, number>>({})
  const [pickedMode, setPickedMode] = useState<RefundMode | null>(null)
  const [reasonType, setReasonType] = useState<ReturnReasonType>('Damaged')
  const [reasonNote, setReasonNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const items = useMemo(() => query.data ?? [], [query.data])
  // Only modes that still have money left to refund.
  const options = useMemo(
    () => (optionsQuery.data ?? []).filter(o => o.remaining > 0),
    [optionsQuery.data],
  )
  const refundMode: RefundMode | null =
    pickedMode && options.some(o => o.mode === pickedMode) ? pickedMode : (options[0]?.mode ?? null)
  const remaining = options.find(o => o.mode === refundMode)?.remaining ?? 0

  const setQty = (productId: string, max: number, next: number) => {
    setError(null)
    const clamped = Math.max(0, Math.min(next, max))
    setQtys(prev => ({ ...prev, [productId]: clamped }))
  }

  const refundGross = round2(items.reduce(
    (s, it) => s + (qtys[it.productId] ?? 0) * it.refundUnitPrice, 0))
  // Server caps the refund at what's left in the chosen mode — show the same.
  const refundTotal = Math.min(refundGross, remaining)
  const selectedCount = items.reduce((s, it) => s + ((qtys[it.productId] ?? 0) > 0 ? 1 : 0), 0)
  const nothingReturnable = items.length > 0 && items.every(it => it.returnableQty <= 0)
  const hasDiscount = items.some(it => it.refundUnitPrice < it.unitPrice)
  const noteMissing = reasonType === 'Other' && !reasonNote.trim()

  const reset = () => {
    setQtys({}); setReasonNote(''); setPickedMode(null); setReasonType('Damaged'); setError(null)
  }

  const handleSubmit = () => {
    if (!billId || !refundMode) return
    const lines = items
      .filter(it => (qtys[it.productId] ?? 0) > 0)
      .map(it => ({ productId: it.productId, qty: qtys[it.productId] }))
    if (lines.length === 0) {
      setError('Choose at least one item and quantity to return.')
      return
    }
    if (noteMissing) {
      setError('Please write why the items are being returned.')
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
          reset()
          onDone(created.code)
        },
        onError: err => setError(err instanceof Error ? err.message : 'Failed to save the return.'),
      },
    )
  }

  const handleClose = () => {
    if (createReturn.isPending) return
    reset()
    onClose()
  }

  const loading = query.isLoading || optionsQuery.isLoading
  const loadError = query.error ?? optionsQuery.error

  return (
    <Dialog
      open={!!billId}
      // Only Cancel closes — a stray backdrop click / Escape must not drop a half-entered return.
      onClose={(_e, reason) => {
        if (reason === 'backdropClick' || reason === 'escapeKeyDown') return
        handleClose()
      }}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Undo2 className="w-5 h-5 text-[#C62828]" />
        Return items {billCode ? `· bill ${billCode}` : ''}
        {admin && (
          <Box component="span" sx={{ ml: 'auto', fontSize: 11, fontWeight: 700, color: '#7A3E00', bgcolor: '#FFE0B2', px: 1, py: 0.25, borderRadius: 1 }}>
            ADMIN
          </Box>
        )}
      </DialogTitle>
      <DialogContent dividers>
        {loading && <Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress size={24} /></Box>}
        {!loading && loadError && (
          <Alert severity="error">
            {loadError instanceof Error ? loadError.message : 'Failed to load the bill.'}
          </Alert>
        )}

        {!loading && !loadError && (
          <>
            {nothingReturnable && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Every item on this bill has already been returned.
              </Alert>
            )}
            {!nothingReturnable && options.length === 0 && (
              <Alert severity="info" sx={{ mb: 2 }}>
                The full amount of this bill has already been refunded.
              </Alert>
            )}
            {hasDiscount && (
              <Alert severity="info" sx={{ mb: 2 }}>
                This bill had a discount, so each item refunds at the discounted price.
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
                        {formatINR(it.refundUnitPrice)} each
                        {it.refundUnitPrice < it.unitPrice ? ` (MRP ${formatINR(it.unitPrice)})` : ''}
                        {' · '}billed {it.billedQty}
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

            {/* Refund mode — only the modes this bill was paid in. */}
            {options.length > 0 && (
              <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                {options.map(({ mode, remaining: left }) => {
                  const active = refundMode === mode
                  return (
                    <Button
                      key={mode}
                      fullWidth
                      disableElevation
                      variant={active ? 'contained' : 'outlined'}
                      startIcon={MODE_META[mode].icon}
                      onClick={() => setPickedMode(mode)}
                      sx={{
                        textTransform: 'none', fontWeight: 700, flexDirection: 'column', lineHeight: 1.2, py: 0.75,
                        ...(active
                          ? { background: 'linear-gradient(90deg, #C28A00 0%, #E6B800 35%, #FFD700 65%, #FFF1A6 100%)', color: '#1F1F1F' }
                          : { color: '#1F1F1F', borderColor: 'rgba(31,31,31,0.35)' }),
                      }}
                    >
                      {MODE_META[mode].label}
                      <Box component="span" sx={{ fontSize: 11, fontWeight: 600, opacity: 0.75 }}>
                        up to {formatINR(left)}
                      </Box>
                    </Button>
                  )
                })}
              </Box>
            )}

            <TextField
              select
              fullWidth
              label="Reason"
              value={reasonType}
              onChange={e => setReasonType(e.target.value as ReturnReasonType)}
              sx={{ mt: 2 }}
              helperText={reasonType === 'Damaged' ? 'Damaged items are written off — they do not go back on the shelf.' : undefined}
            >
              {REASONS.map(r => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
            </TextField>

            <TextField
              fullWidth
              multiline
              minRows={2}
              label={reasonType === 'Other' ? 'Note (required)' : 'Note (optional)'}
              required={reasonType === 'Other'}
              value={reasonNote}
              onChange={e => { setReasonNote(e.target.value); setError(null) }}
              sx={{ mt: 2 }}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Box sx={{ fontSize: 14, fontWeight: 800 }}>
          {refundMode === 'Credit' ? 'Udhaar reduced' : 'Refund'}: {formatINR(refundTotal)}
          {selectedCount > 0 ? <Box component="span" sx={{ fontSize: 12, fontWeight: 600, color: '#1F1F1F99', ml: 1 }}>({selectedCount} {selectedCount === 1 ? 'item' : 'items'})</Box> : null}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={handleClose} disabled={createReturn.isPending} sx={{ textTransform: 'none', fontWeight: 700 }}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={refundTotal <= 0 || !refundMode || noteMissing || createReturn.isPending || nothingReturnable}
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
