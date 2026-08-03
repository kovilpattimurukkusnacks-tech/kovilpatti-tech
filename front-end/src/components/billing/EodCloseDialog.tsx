import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  TextField,
} from '@mui/material'
import { X, CheckCircle2, Wallet } from 'lucide-react'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import { useCloseEod, useEodExpected } from '../../hooks/useEod'
import { DENOMINATIONS } from '../../api/eod/types'
import { ValidationError } from '../../api/errors'

type Props = {
  open: boolean
  onClose: () => void
  onClosed: () => void
}

/** Zero-count map so the denomination grid always starts populated. */
const emptyCounts = (): Record<number, string> =>
  DENOMINATIONS.reduce((acc, d) => ({ ...acc, [d]: '' }), {} as Record<number, string>)

export default function EodCloseDialog({ open, onClose, onClosed }: Props) {
  const expected = useEodExpected(undefined, undefined, open)
  const closeEod = useCloseEod()

  const [counts, setCounts] = useState<Record<number, string>>(emptyCounts)
  const [notes, setNotes]   = useState('')
  const [err, setErr]       = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Reset on open so the previous session's counts don't linger.
  useEffect(() => {
    if (!open) return
    setCounts(emptyCounts())
    setNotes('')
    setErr(null)
    setSuccess(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const physicalCash = useMemo(
    () => DENOMINATIONS.reduce((sum, d) => sum + d * (parseInt(counts[d] || '0', 10) || 0), 0),
    [counts],
  )
  const expectedCash = expected.data?.expectedCash ?? 0
  const variance     = physicalCash - expectedCash
  const isShort      = variance < 0
  const isSurplus    = variance > 0

  const setCount = (denom: number, v: string) => {
    // Digit-only guard so a typo doesn't nuke the sum with NaN.
    if (v !== '' && !/^\d+$/.test(v)) return
    setCounts(prev => ({ ...prev, [denom]: v }))
  }

  const handleClose = async () => {
    if (!expected.data) return
    setErr(null)
    try {
      await closeEod.mutateAsync({
        windowFrom: expected.data.windowFrom,
        windowTo:   expected.data.windowTo,
        denominations: DENOMINATIONS.map(d => ({
          denomination: d,
          count: parseInt(counts[d] || '0', 10) || 0,
        })),
        notes: notes.trim() || null,
      })
      setSuccess(true)
      // Small pause so the cashier sees the confirmation before the dialog closes.
      setTimeout(() => { onClosed(); onClose() }, 900)
    } catch (e) {
      const msg = e instanceof ValidationError ? e.flatten()
        : e instanceof Error ? e.message
        : 'Failed to close the till.'
      setErr(msg)
    }
  }

  const exp = expected.data
  const busy = closeEod.isPending || expected.isLoading

  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => {
        if (reason === 'backdropClick' || reason === 'escapeKeyDown' || closeEod.isPending) return
        onClose()
      }}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 700 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Wallet className="w-5 h-5" />
          Close day — cash count
        </Box>
        <IconButton size="small" onClick={onClose} disabled={closeEod.isPending}>
          <X className="w-4 h-4" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {expected.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Could not fetch today's tender totals.
          </Alert>
        )}

        {exp && (
          <Box sx={{ fontSize: 12, color: '#1F1F1F99', mb: 2 }}>
            Window: {formatIstDateTime(exp.windowFrom)} → {formatIstDateTime(exp.windowTo)}
            {' · '}
            {exp.billCount} bill{exp.billCount === 1 ? '' : 's'}
            {exp.returnCount > 0 && ` · ${exp.returnCount} return${exp.returnCount === 1 ? '' : 's'}`}
            {exp.cancelCount > 0 && ` · ${exp.cancelCount} cancel${exp.cancelCount === 1 ? '' : 's'}`}
          </Box>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
          {/* Left — computed totals */}
          <Box>
            <Box sx={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.7, mb: 1, color: '#1F1F1F99' }}>
              Expected in till
            </Box>
            <Box sx={{ p: 2, border: '1px solid #E0A800', bgcolor: '#FFF3CD', borderRadius: 1.5 }}>
              <TenderRow label="Cash sales"        value={exp?.cashSales ?? 0} />
              <TenderRow label="UPI sales"         value={exp?.upiSales ?? 0} muted />
              <TenderRow label="Credit sales"      value={exp?.creditSales ?? 0} muted />
              <Box sx={{ my: 1, borderTop: '1px dashed #E0A800' }} />
              <TenderRow label="Cash refunds"      value={-(exp?.cashRefunds ?? 0)} />
              <TenderRow label="Cash cancels"      value={-(exp?.cancelCashBack ?? 0)} />
              <Box sx={{ my: 1, borderTop: '1px solid #1F1F1F' }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 800 }}>
                <span>Expected cash</span>
                <span>{formatINR(expectedCash)}</span>
              </Box>
            </Box>
          </Box>

          {/* Right — denomination grid */}
          <Box>
            <Box sx={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.7, mb: 1, color: '#1F1F1F99' }}>
              Physical count
            </Box>
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              rowGap: 0.75, columnGap: 1.5, alignItems: 'center',
              p: 2, border: '1px solid #1F1F1F22', borderRadius: 1.5,
            }}>
              {DENOMINATIONS.map(d => {
                const n = parseInt(counts[d] || '0', 10) || 0
                return (
                  <Box key={d} sx={{ display: 'contents' }}>
                    <Box sx={{ fontWeight: 700, fontFamily: 'monospace' }}>₹{d}</Box>
                    <TextField
                      size="small"
                      value={counts[d]}
                      onChange={e => setCount(d, e.target.value)}
                      placeholder="0"
                      slotProps={{ htmlInput: { inputMode: 'numeric', style: { textAlign: 'right', fontFamily: 'monospace' } } }}
                    />
                    <Box sx={{ fontSize: 12, color: '#1F1F1F99', minWidth: 68, textAlign: 'right' }}>
                      {formatINR(d * n)}
                    </Box>
                  </Box>
                )
              })}
              <Box sx={{ gridColumn: '1 / -1', mt: 0.5, pt: 0.75, borderTop: '2px solid #1F1F1F', display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                <span>Total counted</span>
                <span>{formatINR(physicalCash)}</span>
              </Box>
            </Box>
          </Box>
        </Box>

        {/* Variance banner */}
        <Box sx={{
          mt: 2, p: 1.5, borderRadius: 1.5, textAlign: 'center', fontWeight: 700,
          border: `1px solid ${isShort ? '#C62828' : isSurplus ? '#E65100' : '#2E7D32'}`,
          bgcolor: isShort ? '#FFEBEE' : isSurplus ? '#FFF3E0' : '#EAF7EE',
          color:  isShort ? '#7A2A2A' : isSurplus ? '#7A3E00' : '#1F5F23',
        }}>
          {variance === 0 ? (
            <span>Match — physical count equals expected cash</span>
          ) : (
            <>Variance: {isShort ? '−' : '+'}{formatINR(Math.abs(variance))} {isShort ? '(short)' : '(surplus)'}</>
          )}
        </Box>

        <TextField
          fullWidth
          multiline
          minRows={2}
          size="small"
          label="Notes (optional)"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="e.g. Missing ₹100 note from morning, will investigate"
          sx={{ mt: 2 }}
        />

        {err && <Alert severity="error" sx={{ mt: 2 }}>{err}</Alert>}
        {success && (
          <Alert severity="success" icon={<CheckCircle2 className="w-5 h-5" />} sx={{ mt: 2 }}>
            Day closed. Snapshot saved.
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={closeEod.isPending} sx={{ textTransform: 'none', fontWeight: 600 }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleClose}
          disabled={busy || !exp}
          sx={{ textTransform: 'none', fontWeight: 700 }}
        >
          {closeEod.isPending ? 'Closing…' : 'Close & save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function TenderRow({ label, value, muted = false }: { label: string; value: number; muted?: boolean }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: muted ? '#1F1F1F99' : '#1F1F1F', py: 0.25 }}>
      <span>{label}</span>
      <span style={{ fontFamily: 'monospace' }}>{value < 0 ? '−' : ''}{formatINR(Math.abs(value))}</span>
    </Box>
  )
}
