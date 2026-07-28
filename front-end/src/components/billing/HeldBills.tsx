import { useState } from 'react'
import {
  Alert, Badge, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Paper,
} from '@mui/material'
import { PauseCircle, Play, Trash2 } from 'lucide-react'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import { useHolds, useDeleteHold } from '../../hooks/useBills'
import { billsApi } from '../../api/bills/api'
import type { BillingProductDto } from '../../api/bills/types'

// ───────────────────────────────────────────────────────────────
// Held (draft) bills (feature #3). A "Held (N)" button opens a drawer
// of parked drafts; Resume loads one back into the cart (and deletes
// the draft), Discard throws it away. Drafts consume no stock.
// ───────────────────────────────────────────────────────────────

export type ResumeLine = { product: BillingProductDto; qty: number }

export default function HeldBills({ onResume }: { onResume: (lines: ResumeLine[]) => void }) {
  const holds = useHolds()
  const deleteHold = useDeleteHold()
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const list = holds.data ?? []

  const handleResume = async (id: string) => {
    setError(null); setBusyId(id)
    try {
      const detail = await billsApi.holdGet(id)
      const lines: ResumeLine[] = detail.items.map(i => ({
        product: {
          id: i.productId, code: i.code, barcode: i.barcode, name: i.name,
          categoryName: null,
          weightValue: i.weightValue, weightUnit: i.weightUnit, mrp: i.mrp, onHand: i.onHand,
        },
        qty: i.qty,
      }))
      onResume(lines)
      await billsApi.holdDelete(id)   // resumed drafts are consumed
      holds.refetch()
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resume the draft.')
    } finally {
      setBusyId(null)
    }
  }

  const handleDiscard = (id: string) => {
    setError(null)
    deleteHold.mutate(id, { onError: e => setError(e instanceof Error ? e.message : 'Could not discard.') })
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        startIcon={
          <Badge badgeContent={list.length} color="error">
            <PauseCircle className="w-4 h-4" />
          </Badge>
        }
        sx={{ textTransform: 'none', fontWeight: 700, color: '#1F1F1F' }}
      >
        Held
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Held bills</DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {list.length === 0 && (
            <Box sx={{ textAlign: 'center', color: '#1F1F1F99', py: 3 }}>No held bills.</Box>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {list.map(h => (
              <Paper key={h.id} elevation={0}
                sx={{ p: 1.5, borderRadius: 2, border: '1px solid rgba(31,31,31,0.15)', bgcolor: '#FFFBE6',
                      display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ fontWeight: 700, fontSize: 13 }}>
                    {h.label || h.customerName || 'Draft'}
                    <Box component="span" sx={{ fontWeight: 500, color: '#1F1F1F99', ml: 1 }}>
                      {h.itemCount} item{h.itemCount === 1 ? '' : 's'} · {formatINR(h.totalAmount)}
                    </Box>
                  </Box>
                  <Box sx={{ fontSize: 11, color: '#1F1F1F99' }}>
                    {formatIstDateTime(h.createdAt)}{h.customerName && h.label ? ` · ${h.customerName}` : ''}
                  </Box>
                </Box>
                <Button size="small" variant="contained" startIcon={<Play className="w-3.5 h-3.5" />}
                  disabled={busyId === h.id}
                  onClick={() => handleResume(h.id)}
                  sx={{ textTransform: 'none', fontWeight: 700 }}>
                  {busyId === h.id ? '…' : 'Resume'}
                </Button>
                <IconButton size="small" onClick={() => handleDiscard(h.id)} aria-label="Discard draft">
                  <Trash2 className="w-3.5 h-3.5 text-[#C62828]" />
                </IconButton>
              </Paper>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)} variant="contained" sx={{ textTransform: 'none', fontWeight: 700 }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
