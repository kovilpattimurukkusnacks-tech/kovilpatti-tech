import { useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { useProducts } from '../../hooks/useProducts'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useAdjustInventory } from '../../hooks/useShopInventory'
import type { ProductDto } from '../../api/products/types'
import { CREAM } from '../sales/salesTheme'

type Direction = 'add' | 'remove'

/**
 * Admin manual stock correction for one shop (damaged, expired, miscount).
 * Writes a ManualAdjustment movement with the reason as its note. Product
 * picker searches server-side (debounced, top 20) so it scales to any
 * catalogue size. `preset` pre-fills the product when opened from a row.
 * Mount it only while open (the parent does) so each open starts fresh.
 */
export default function StockAdjustDialog({ open, shopId, shopName, preset, onClose, onDone }: {
  open: boolean
  shopId: string
  shopName: string
  preset: { productId: string; label: string; onHand: number } | null
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [product, setProduct] = useState<{ id: string; label: string } | null>(
    preset ? { id: preset.productId, label: preset.label } : null)
  const [direction, setDirection] = useState<Direction>('remove')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const adjust = useAdjustInventory()

  const qtyNum = Number(qty)
  const valid = !!product && qty.trim() !== '' && Number.isFinite(qtyNum) && qtyNum > 0 && reason.trim().length >= 3

  const submit = async () => {
    if (!product || !valid) return
    setErr(null)
    try {
      const res = await adjust.mutateAsync({
        shopId,
        req: { productId: product.id, qtyDelta: direction === 'add' ? qtyNum : -qtyNum, reason: reason.trim() },
      })
      onDone(`${product.label}: on-hand is now ${res.onHand}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Adjustment failed.')
    }
  }

  return (
    <Dialog
      open={open}
      onClose={(_e, r) => { if (r === 'backdropClick' || r === 'escapeKeyDown') return; onClose() }}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { sx: { bgcolor: CREAM, border: '2px solid #1F1F1F' } } }}
    >
      <DialogTitle sx={{ fontWeight: 800 }}>Adjust stock — {shopName}</DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {preset ? (
          <Box>
            <Typography sx={{ fontWeight: 800 }}>{preset.label}</Typography>
            <Typography variant="body2" sx={{ opacity: 0.7 }}>Current on-hand: {preset.onHand}</Typography>
          </Box>
        ) : (
          <ProductSearchPicker onPick={setProduct} />
        )}

        <ToggleButtonGroup exclusive size="small" value={direction} onChange={(_e, v) => { if (v) setDirection(v) }}>
          <ToggleButton value="remove" sx={{ textTransform: 'none', fontWeight: 700 }}>Remove stock (damaged / expired)</ToggleButton>
          <ToggleButton value="add" sx={{ textTransform: 'none', fontWeight: 700 }}>Add stock (found / miscount)</ToggleButton>
        </ToggleButtonGroup>

        <TextField
          label="Quantity (packets)"
          value={qty}
          onChange={e => setQty(e.target.value.replace(/[^\d.]/g, ''))}
          slotProps={{ htmlInput: { inputMode: 'decimal', autoComplete: 'off' } }}
          sx={{ maxWidth: 220, bgcolor: CREAM }}
        />
        <TextField
          label="Reason"
          value={reason}
          onChange={e => setReason(e.target.value)}
          multiline
          minRows={2}
          helperText="Required — saved with the stock movement"
          slotProps={{ htmlInput: { maxLength: 500 } }}
          sx={{ bgcolor: CREAM }}
        />
        {err && <Alert severity="error">{err}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={adjust.isPending} sx={{ textTransform: 'none', fontWeight: 700 }}>Cancel</Button>
        <Button variant="contained" color="primary" onClick={submit} disabled={!valid || adjust.isPending}
          sx={{ textTransform: 'none', fontWeight: 700 }}>
          {adjust.isPending ? 'Saving…' : 'Save adjustment'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** Server-side product search (debounced, top 20). Rendered only when no
 *  product is pre-selected, so it doesn't fetch otherwise. */
function ProductSearchPicker({ onPick }: { onPick: (p: { id: string; label: string } | null) => void }) {
  const [text, setText] = useState('')
  const debounced = useDebouncedValue(text, 250)
  const products = useProducts({ search: debounced.trim() || undefined, pageSize: 20 })
  return (
    <Autocomplete<ProductDto>
      options={products.data?.items ?? []}
      loading={products.isFetching}
      filterOptions={x => x}
      getOptionLabel={o => `${o.code} · ${o.name}`}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onInputChange={(_e, v, reason) => { if (reason === 'input') setText(v) }}
      onChange={(_e, v) => onPick(v ? { id: v.id, label: `${v.code} · ${v.name}` } : null)}
      renderInput={p => <TextField {...p} label="Product" placeholder="Type code or name" autoFocus sx={{ bgcolor: CREAM }} />}
      noOptionsText={debounced.trim() ? 'No matching product' : 'Type to search'}
    />
  )
}
