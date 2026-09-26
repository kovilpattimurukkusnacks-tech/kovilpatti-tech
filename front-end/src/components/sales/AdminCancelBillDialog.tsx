import { useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField,
} from '@mui/material'
import { useAdminCancelBill } from '../../hooks/useAdminPos'
import type { CancelReasonType } from '../../api/bills/types'
import { CREAM } from './salesTheme'

const REASONS: { value: CancelReasonType; label: string }[] = [
  { value: 'Mistake', label: 'Billing mistake' },
  { value: 'Duplicate', label: 'Duplicate bill' },
  { value: 'CustomerRefused', label: 'Customer refused' },
  { value: 'Other', label: 'Other' },
]

/** Admin override cancel (25-Sep-2026) — any cashier's bill, including bills
 *  from a day that is already closed. Stock goes back, a credit tender is
 *  reversed on the customer's balance; blocked once the bill has a return. */
export default function AdminCancelBillDialog({ bill, onClose }: {
  bill: { id: string; code: string } | null
  onClose: () => void
}) {
  const cancel = useAdminCancelBill()
  const [reasonType, setReasonType] = useState<CancelReasonType>('Mistake')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const noteMissing = reasonType === 'Other' && !note.trim()

  const close = () => {
    if (cancel.isPending) return
    setReasonType('Mistake'); setNote(''); setError(null)
    onClose()
  }

  const confirm = () => {
    if (!bill || noteMissing) return
    setError(null)
    cancel.mutate(
      { id: bill.id, req: { reasonType, reasonNote: note.trim() || null } },
      {
        onSuccess: close,
        onError: e => setError(e instanceof Error ? e.message : 'Failed to cancel the bill.'),
      },
    )
  }

  return (
    <Dialog
      open={!!bill}
      onClose={(_e, reason) => {
        if (reason === 'backdropClick' || reason === 'escapeKeyDown') return
        close()
      }}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { bgcolor: CREAM, border: '2px solid #1F1F1F' } } }}
    >
      <DialogTitle sx={{ fontWeight: 800 }}>Cancel bill {bill?.code}?</DialogTitle>
      <DialogContent>
        <Box sx={{ fontSize: 13, color: '#1F1F1F99', mb: 2 }}>
          Admin cancel — the items go back into the shop's stock and any credit on the bill is
          taken off the customer's balance. If the day was already closed, that close stays as it
          was; the cancel shows in the shop's next close. This cannot be undone.
        </Box>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          select fullWidth label="Reason" value={reasonType}
          onChange={e => setReasonType(e.target.value as CancelReasonType)}
          sx={{ mb: 2 }}
        >
          {REASONS.map(r => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
        </TextField>
        <TextField
          fullWidth multiline minRows={2}
          label={reasonType === 'Other' ? 'Note (required)' : 'Note (optional)'}
          required={reasonType === 'Other'}
          value={note}
          onChange={e => { setNote(e.target.value); setError(null) }}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close} disabled={cancel.isPending} sx={{ textTransform: 'none', fontWeight: 700 }}>
          Keep Bill
        </Button>
        <Button
          variant="contained" color="error"
          disabled={cancel.isPending || noteMissing}
          onClick={confirm}
          sx={{ textTransform: 'none', fontWeight: 700 }}
        >
          {cancel.isPending ? 'Cancelling…' : 'Cancel Bill'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
