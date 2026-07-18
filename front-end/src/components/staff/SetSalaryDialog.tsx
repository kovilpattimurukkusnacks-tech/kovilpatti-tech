import { useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, TextField,
} from '@mui/material'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import dayjs from 'dayjs'
import { Wallet, X } from 'lucide-react'
import { istToday } from '../../utils/istDate'
import type { StaffSalaryRowDto } from '../../api/staff-salaries/types'

// Blocks the classic <input type="number"> footgun — browsers accept 'e'
// (scientific notation) and +/- as valid characters even though the field
// only ever holds a positive rupee amount.
const blockNonNumericKeys = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault()
}

export default function SetSalaryDialog({
  open, staff, submitting, submitError, onClose, onSave,
}: {
  open: boolean
  staff: StaffSalaryRowDto[]
  submitting: boolean
  submitError: string | null
  onClose: () => void
  onSave: (values: { staffId: string; monthlyAmount: number; effectiveFrom: string }) => Promise<void>
}) {
  const [staffId, setStaffId] = useState('')
  const [monthlyAmount, setMonthlyAmount] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const first = staff[0]
    setStaffId(first?.staffId ?? '')
    setMonthlyAmount(first && first.monthlyAmount > 0 ? String(first.monthlyAmount) : '')
    setEffectiveFrom(istToday())
    setErr(null)
    const t = setTimeout(() => firstFieldRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [open, staff])

  // Switching staff prefills their existing monthly amount (if any) instead
  // of leaving the previous staff's typed value sitting in the field.
  const handleStaffChange = (id: string) => {
    setStaffId(id)
    const picked = staff.find(s => s.staffId === id)
    setMonthlyAmount(picked && picked.monthlyAmount > 0 ? String(picked.monthlyAmount) : '')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = Number(monthlyAmount)
    if (!staffId)                        { setErr('Pick a staff member'); return }
    if (!monthlyAmount || amount <= 0)   { setErr('Enter a monthly salary amount'); return }
    if (!effectiveFrom)                  { setErr('Enter an effective-from date'); return }
    setErr(null)

    try {
      await onSave({ staffId, monthlyAmount: amount, effectiveFrom })
    } catch {
      // Surfaces via submitError prop
    }
  }

  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => {
        if (reason === 'backdropClick' || submitting) return
        onClose()
      }}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 3, backgroundColor: '#FFFBE6' } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Wallet className="w-5 h-5" />
          Set Monthly Salary
        </Box>
        <IconButton size="small" onClick={onClose} disabled={submitting}><X className="w-4 h-4" /></IconButton>
      </DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            select label="Staff" value={staffId} onChange={e => handleStaffChange(e.target.value)}
            required size="small" disabled={submitting} inputRef={firstFieldRef}
          >
            {staff.map(s => (
              <MenuItem key={s.staffId} value={s.staffId}>
                {s.fullName} — {s.shopName ?? s.inventoryName ?? '—'}
              </MenuItem>
            ))}
          </TextField>

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              label="Monthly Salary (₹)" type="number" value={monthlyAmount}
              onChange={e => setMonthlyAmount(e.target.value)} onKeyDown={blockNonNumericKeys}
              required size="small" disabled={submitting}
              slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
            />
            {/* Same MUI X DatePicker used across the app (ShopUtilities,
                Accounts filters) — not the OS-native date input. Explicit
                flip/preventOverflow so the calendar repositions itself
                instead of overflowing past the bottom of the viewport when
                the field sits low in the dialog. */}
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <DatePicker
                label="Effective From"
                format="DD/MM/YYYY"
                value={effectiveFrom ? dayjs(effectiveFrom) : null}
                onChange={v => { if (v && v.isValid()) setEffectiveFrom(v.format('YYYY-MM-DD')) }}
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

          <Box sx={{ fontSize: 12, color: '#64748b' }}>
            This only sets the expected amount — no ledger entry is created until a Pay or Deduct is recorded.
          </Box>

          {err && <Box sx={{ color: 'error.main', fontSize: 14 }}>{err}</Box>}
          {submitError && <Alert severity="error" sx={{ whiteSpace: 'pre-line' }}>{submitError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={onClose} variant="outlined" disabled={submitting} sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#1F1F1F', color: '#1F1F1F', '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' } }}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting} sx={{ textTransform: 'none', fontWeight: 600 }}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
