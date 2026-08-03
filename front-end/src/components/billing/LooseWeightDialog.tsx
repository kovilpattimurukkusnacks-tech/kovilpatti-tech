import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, ToggleButton,
  ToggleButtonGroup, TextField,
} from '@mui/material'
import { Scale } from 'lucide-react'
import { formatINR } from '../../utils/format'
import type { BillingProductDto } from '../../api/bills/types'

type Props = {
  open: boolean
  product: BillingProductDto | null
  onClose: () => void
  onConfirm: (looseWeightG: number) => void
}

/** Pack size in grams — 'kg' → weightValue × 1000, 'g' → weightValue. Null
 *  when the product doesn't carry a numeric weight in a weighable unit. */
function packSizeInGrams(p: BillingProductDto | null): number | null {
  if (!p || !p.weightValue || p.weightValue <= 0) return null
  if (p.weightUnit === 'kg') return p.weightValue * 1000
  if (p.weightUnit === 'g')  return p.weightValue
  return null
}

/** Prompts the cashier for a weight when adding a sold-loose product. The
 *  cashier types in either grams or kg (toggle); we always emit grams to
 *  the BE. The dialog blocks Apply until weight > 0 and shows a live price
 *  preview. */
export default function LooseWeightDialog({ open, product, onClose, onConfirm }: Props) {
  const [unit, setUnit]   = useState<'g' | 'kg'>('g')
  const [value, setValue] = useState('')
  const [err, setErr]     = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    // Default the toggle to the product's own unit so keying "500" reads
    // naturally for a 500g SKU or a "0.5" for a 1kg SKU.
    setUnit(product?.weightUnit === 'kg' ? 'kg' : 'g')
    setValue('')
    setErr(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id])

  const packG = packSizeInGrams(product)
  const weightG = useMemo(() => {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) return 0
    return unit === 'kg' ? Math.round(n * 1000) : Math.round(n)
  }, [value, unit])

  const previewPrice = useMemo(() => {
    if (!product || !packG || weightG <= 0) return 0
    return (weightG / packG) * product.mrp
  }, [product, packG, weightG])

  const packetsConsumed = packG && weightG > 0 ? Math.ceil(weightG / packG) : 0
  const stockOk = product ? packetsConsumed <= product.onHand : true

  const handleApply = () => {
    if (weightG <= 0) { setErr('Enter a weight greater than zero.'); return }
    if (!packG) { setErr('This product has no pack weight — mark it in g/kg first.'); return }
    if (!stockOk) { setErr(`Not enough stock — sale would need ${packetsConsumed} packet(s), only ${product?.onHand ?? 0} on hand.`); return }
    onConfirm(weightG)
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
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Scale className="w-5 h-5" />
        Sell loose · {product?.name ?? ''}
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ fontSize: 12, color: '#1F1F1F99', mb: 1.5 }}>
          {product && (
            <>
              Pack: {product.weightValue} {product.weightUnit ?? ''}
              {' · '}
              MRP {formatINR(product.mrp)} per pack
              {packG && ` · Rate ${formatINR((product.mrp / packG) * 1000)}/kg`}
              {' · '}
              on-hand {product.onHand}
            </>
          )}
        </Box>

        <ToggleButtonGroup
          value={unit}
          exclusive
          onChange={(_e, v: 'g' | 'kg' | null) => v && setUnit(v)}
          size="small"
          fullWidth
          sx={{ mb: 2 }}
        >
          <ToggleButton value="g"  sx={{ textTransform: 'none', fontWeight: 700 }}>Grams</ToggleButton>
          <ToggleButton value="kg" sx={{ textTransform: 'none', fontWeight: 700 }}>Kilograms</ToggleButton>
        </ToggleButtonGroup>

        <TextField
          fullWidth
          size="small"
          type="number"
          autoFocus
          label={unit === 'g' ? 'Weight (grams)' : 'Weight (kg, decimals OK)'}
          value={value}
          onChange={e => { setValue(e.target.value); setErr(null) }}
          slotProps={{ htmlInput: { inputMode: 'decimal', min: 0 } }}
        />

        <Box sx={{ mt: 2, p: 1.5, borderRadius: 1.5, bgcolor: '#FFF3CD', border: '1px solid #E0A800' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>Sold</span>
            <strong>{weightG > 0 ? `${weightG} g` : '—'}</strong>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>Packet-equivalent (deducted)</span>
            <strong>{packetsConsumed || '—'}</strong>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 800, mt: 0.5, pt: 0.5, borderTop: '1px dashed #E0A800' }}>
            <span>Price</span>
            <span>{formatINR(previewPrice)}</span>
          </Box>
        </Box>

        {err && <Alert severity="error" sx={{ mt: 2 }}>{err}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: 'none', fontWeight: 600 }}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleApply}
          sx={{ textTransform: 'none', fontWeight: 700 }}
        >
          Add to bill
        </Button>
      </DialogActions>
    </Dialog>
  )
}
