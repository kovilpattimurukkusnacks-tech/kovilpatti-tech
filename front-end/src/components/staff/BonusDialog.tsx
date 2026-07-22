import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, TextField,
} from '@mui/material'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import dayjs from 'dayjs'
import { Gift, X } from 'lucide-react'
import { istToday } from '../../utils/istDate'
import AmountField from './AmountField'
import type { StaffSalaryRowDto } from '../../api/staff-salaries/types'

/** A Bonus is recorded through the same Pay flow as Cash/UPI/Bank Transfer,
 *  just with mode fixed to "Bonus" — no new backend/table needed, and it
 *  tallies with Accounts identically to a regular salary payment. */
export default function BonusDialog({
  open, staff, submitting, submitError, onClose, onSave,
}: {
  open: boolean
  staff: StaffSalaryRowDto | null
  submitting: boolean
  submitError: string | null
  onClose: () => void
  onSave: (values: { amount: number; txnDate: string; note: string }) => Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const [txnDate, setTxnDate] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setAmount('')
    setTxnDate(istToday())
    setNote('')
    setErr(null)
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const amt = Number(amount)
    if (!amount || amt <= 0) { setErr('Enter an amount'); return }
    if (!txnDate)            { setErr('Enter a date'); return }
    setErr(null)

    try {
      await onSave({ amount: amt, txnDate, note: note.trim() })
    } catch {
      // Surfaces via submitError prop
    }
  }

  if (!staff) return null

  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => {
        if (reason === 'backdropClick' || submitting) return
        onClose()
      }}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 3, backgroundColor: '#FFFBE6' } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Gift className="w-5 h-5" />
          Bonus
        </Box>
        <IconButton size="small" onClick={onClose} disabled={submitting}><X className="w-4 h-4" /></IconButton>
      </DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ fontSize: 13, color: '#64748b' }}>
            Recording a bonus for <b>{staff.fullName}</b> ({staff.shopName ?? staff.inventoryName ?? '—'}).
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <AmountField label="Amount (₹)" value={amount} onChange={setAmount} required autoFocus disabled={submitting} />
            {/* Same MUI X DatePicker used across the app — not the
                OS-native date input. Explicit flip/preventOverflow so the
                calendar repositions itself instead of overflowing past
                the bottom of the viewport. */}
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <DatePicker
                label="Date"
                format="DD/MM/YYYY"
                value={txnDate ? dayjs(txnDate) : null}
                onChange={v => { if (v && v.isValid()) setTxnDate(v.format('YYYY-MM-DD')) }}
                slotProps={{
                  textField: { size: 'small', required: true, disabled: submitting },
                  popper: {
                    modifiers: [
                      { name: 'flip', enabled: true, options: { fallbackPlacements: ['top', 'bottom'] } },
                      { name: 'preventOverflow', enabled: true, options: { boundary: 'viewport', altAxis: true } },
                    ],
                  },
                }}
              />
            </LocalizationProvider>
          </Box>

          <TextField label="Note (optional)" value={note} onChange={e => setNote(e.target.value)} size="small" placeholder="e.g. Festival bonus" disabled={submitting} />

          <Box sx={{ fontSize: 12, color: '#64748b' }}>
            Counted the same as a regular payment — it's added to Paid this month and posts to{' '}
            {staff.inAccounts ? 'the Staff Salary line in Accounts.' : 'the company-wide Godown Expenses line in Accounts.'}
          </Box>

          {err && <Box sx={{ color: 'error.main', fontSize: 14 }}>{err}</Box>}
          {submitError && <Alert severity="error" sx={{ whiteSpace: 'pre-line' }}>{submitError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={onClose} variant="outlined" disabled={submitting} sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#1F1F1F', color: '#1F1F1F', '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' } }}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting} sx={{ textTransform: 'none', fontWeight: 600 }}>
            {submitting ? 'Saving…' : 'Save Bonus'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
