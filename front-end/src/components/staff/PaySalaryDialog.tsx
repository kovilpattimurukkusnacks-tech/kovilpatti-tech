import { useEffect, useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, TextField,
} from '@mui/material'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import dayjs from 'dayjs'
import { IndianRupee, X } from 'lucide-react'
import { istToday } from '../../utils/istDate'
import type { StaffSalaryRowDto } from '../../api/staff-salaries/types'

const MODES = ['Cash', 'UPI', 'Bank Transfer'] as const

// Blocks the classic <input type="number"> footgun — browsers accept 'e'
// (scientific notation) and +/- as valid characters even though the field
// only ever holds a positive rupee amount.
const blockNonNumericKeys = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault()
}

export default function PaySalaryDialog({
  open, staff, submitting, submitError, onClose, onSave,
}: {
  open: boolean
  staff: StaffSalaryRowDto | null
  submitting: boolean
  submitError: string | null
  onClose: () => void
  onSave: (values: { amount: number; mode: string; txnDate: string; note: string }) => Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<string>('Cash')
  const [txnDate, setTxnDate] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setAmount('')
    setMode('Cash')
    setTxnDate(istToday())
    setNote('')
    setErr(null)
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const amt = Number(amount)
    if (!amount || amt <= 0) { setErr('Enter an amount'); return }
    if (!mode.trim())        { setErr('Enter a payment mode'); return }
    if (!txnDate)            { setErr('Enter a date'); return }
    setErr(null)

    try {
      await onSave({ amount: amt, mode: mode.trim(), txnDate, note: note.trim() })
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
          <IndianRupee className="w-5 h-5" />
          Pay Salary
        </Box>
        <IconButton size="small" onClick={onClose} disabled={submitting}><X className="w-4 h-4" /></IconButton>
      </DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ fontSize: 13, color: '#64748b' }}>
            Recording a payment for <b>{staff.fullName}</b> ({staff.shopName ?? staff.inventoryName ?? '—'}).
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              label="Amount (₹)" type="number" value={amount} onChange={e => setAmount(e.target.value)}
              onKeyDown={blockNonNumericKeys} required size="small" autoFocus disabled={submitting}
              slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
            />
            {/* freeSolo — Cash/UPI/Bank Transfer are suggestions, not a hard
                list; a shop can type e.g. "Cheque" and it's stored as-is. */}
            <Autocomplete
              freeSolo
              options={MODES}
              value={mode}
              onChange={(_e, v) => setMode(v ?? '')}
              onInputChange={(_e, v) => setMode(v)}
              disabled={submitting}
              renderInput={(params) => <TextField {...params} label="Mode" size="small" />}
            />
          </Box>

          {/* Same MUI X DatePicker used across the app (ShopUtilities,
              Accounts filters) — not the OS-native date input. Explicit
              flip/preventOverflow so the calendar repositions itself
              instead of overflowing past the bottom of the viewport when
              the field sits low in the dialog. */}
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DatePicker
              label="Date"
              format="DD/MM/YYYY"
              value={txnDate ? dayjs(txnDate) : null}
              onChange={v => { if (v && v.isValid()) setTxnDate(v.format('YYYY-MM-DD')) }}
              slotProps={{
                textField: { size: 'small', required: true, disabled: submitting, fullWidth: true },
                popper: {
                  modifiers: [
                    { name: 'flip', enabled: true, options: { fallbackPlacements: ['top', 'bottom'] } },
                    { name: 'preventOverflow', enabled: true, options: { boundary: 'viewport', altAxis: true } },
                  ],
                },
              }}
            />
          </LocalizationProvider>
          <TextField label="Note (optional)" value={note} onChange={e => setNote(e.target.value)} size="small" placeholder="e.g. July salary, part payment" disabled={submitting} />

          {!staff.inAccounts && (
            <Box sx={{ fontSize: 12, color: '#8A6D3B', fontWeight: 600 }}>
              This staff member has no shop assigned — this payment posts to the company-wide Godown Expenses line in Accounts instead of a per-shop line.
            </Box>
          )}

          {err && <Box sx={{ color: 'error.main', fontSize: 14 }}>{err}</Box>}
          {submitError && <Alert severity="error" sx={{ whiteSpace: 'pre-line' }}>{submitError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={onClose} variant="outlined" disabled={submitting} sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#1F1F1F', color: '#1F1F1F', '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' } }}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting} sx={{ textTransform: 'none', fontWeight: 600 }}>
            {submitting ? 'Saving…' : 'Save Payment'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
