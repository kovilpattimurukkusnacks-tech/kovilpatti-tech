import { useEffect, useState } from 'react'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Tab, Tabs,
  TextField,
} from '@mui/material'
import { Percent, IndianRupee } from 'lucide-react'
import { formatINR } from '../../utils/format'
import type { DiscountKind } from '../../api/bills/types'

export type BillDiscount =
  | { kind: 'Percent'; value: number }
  | { kind: 'Amount';  value: number }
  | null

type Props = {
  open: boolean
  onClose: () => void
  /** Current subtotal so the dialog can preview the ₹ actually taken off. */
  subtotal: number
  /** Whatever's on the bill right now (may be null). */
  current: BillDiscount
  onApply: (d: BillDiscount) => void
}

/** Bill-level discount picker. Percent or flat ₹ off — mutually exclusive.
 *  Clear button removes the discount entirely. */
export default function DiscountDialog({ open, onClose, subtotal, current, onApply }: Props) {
  const [kind, setKind]   = useState<DiscountKind>(current?.kind ?? 'Percent')
  const [value, setValue] = useState<string>(current ? String(current.value) : '')
  const [err, setErr]     = useState<string | null>(null)

  // Reset the dialog to the current bill state each time it opens. Only
  // depending on `open` here — including `current` would overwrite mid-typing
  // if the outer prop changes reference during render (learnt this from the
  // return-config bug on ShopRequestNew).
  useEffect(() => {
    if (!open) return
    setKind(current?.kind ?? 'Percent')
    setValue(current ? String(current.value) : '')
    setErr(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const numeric = Number(value)
  const validNumber = value.trim() !== '' && Number.isFinite(numeric) && numeric >= 0
  const previewDiscount = !validNumber
    ? 0
    : kind === 'Percent'
      ? Math.min(subtotal, Math.round(subtotal * numeric) / 100)
      : Math.min(subtotal, numeric)
  const previewTotal = subtotal - previewDiscount

  const handleApply = () => {
    if (!validNumber) { setErr('Enter a valid discount value.'); return }
    if (kind === 'Percent' && (numeric < 0 || numeric > 100)) {
      setErr('Percent discount must be between 0 and 100.')
      return
    }
    if (kind === 'Amount' && numeric > subtotal) {
      setErr('Discount cannot exceed the subtotal.')
      return
    }
    if (numeric === 0) {
      // 0% or ₹0 = no discount at all. Skip the state churn and just clear.
      onApply(null)
    } else {
      onApply({ kind, value: numeric })
    }
    onClose()
  }

  const handleClear = () => {
    onApply(null)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => {
        if (reason === 'backdropClick' || reason === 'escapeKeyDown') return
        onClose()
      }}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle sx={{ fontWeight: 700 }}>Apply discount</DialogTitle>
      <DialogContent dividers>
        <Tabs
          value={kind}
          onChange={(_e, v: DiscountKind) => { setKind(v); setErr(null) }}
          variant="fullWidth"
          sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontWeight: 600 } }}
        >
          <Tab
            value="Percent"
            icon={<Percent className="w-4 h-4" />}
            iconPosition="start"
            label="Percent"
          />
          <Tab
            value="Amount"
            icon={<IndianRupee className="w-4 h-4" />}
            iconPosition="start"
            label="Flat ₹"
          />
        </Tabs>

        <TextField
          fullWidth
          size="small"
          type="number"
          label={kind === 'Percent' ? 'Percent off (0-100)' : 'Amount off (₹)'}
          value={value}
          onChange={e => { setValue(e.target.value); setErr(null) }}
          autoFocus
          slotProps={{ htmlInput: { inputMode: 'decimal' } }}
        />

        <Box sx={{ mt: 2, p: 1.5, borderRadius: 1.5, bgcolor: '#FFF3CD', border: '1px solid #E0A800' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>Subtotal</span>
            <strong>{formatINR(subtotal)}</strong>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#8A6200' }}>
            <span>Discount</span>
            <strong>− {formatINR(previewDiscount)}</strong>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 800, mt: 0.5, pt: 0.5, borderTop: '1px dashed #E0A800' }}>
            <span>After discount</span>
            <span>{formatINR(previewTotal)}</span>
          </Box>
        </Box>

        {err && <Box sx={{ mt: 2, color: 'error.main', fontSize: 13 }}>{err}</Box>}
      </DialogContent>
      <DialogActions>
        {current && (
          <Button onClick={handleClear} color="error" sx={{ textTransform: 'none', fontWeight: 600 }}>
            Clear
          </Button>
        )}
        <Button onClick={onClose} sx={{ textTransform: 'none', fontWeight: 600 }}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleApply}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  )
}
