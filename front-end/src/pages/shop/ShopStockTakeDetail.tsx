import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, InputAdornment, Paper, Popover, Switch, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import { ArrowLeft, Ban, Check, FileText, Search } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import {
  useStockTake, useSubmitStockTake, useCancelStockTake, useUpsertStockTakeLine,
} from '../../hooks/useShopInventory'
import { formatIstDateTime } from '../../utils/formatDate'
import { formatAmountInput, stripAmountFormat } from '../../utils/format'
import type { StockTakeDetailDto, StockTakeItemDto, StockTakeStatus } from '../../api/shop-inventory/types'

// Same STATUS palette as the list page — kept inline (small, no shared
// util) so the two files stay decoupled and the visual language matches.
const STATUS_STYLE: Record<StockTakeStatus, { bg: string; color: string; border: string }> = {
  Draft:     { bg: '#FFF8E1', color: '#7C4A00', border: 'rgba(194,138,0,0.45)' },
  Submitted: { bg: '#E8F5E9', color: '#1B5E20', border: 'rgba(46,125,50,0.45)' },
  Cancelled: { bg: '#F5F5F5', color: '#616161', border: 'rgba(0,0,0,0.15)' },
}

const HEAD_SX = {
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  fontSize: 11,
}

const UPSERT_DEBOUNCE_MS = 400

/**
 * Stock-take count entry / detail page. Draft sessions render an editable
 * line-by-line count grid; Submitted / Cancelled sessions render read-only.
 *
 * State model (Draft):
 *   • Server data is the source of truth for `qtyDiff`, `note`, and the
 *     final on-disk `countedQty`.
 *   • Local "pending edits" Map<productId, {counted, note}> overlays the
 *     server rows so keystrokes don't wait for a network round-trip.
 *   • On input blur, a debounced upsert flushes the local edit to the
 *     server; the hook's onSuccess patches the detail cache which then
 *     clears the pending overlay for that row.
 */
export default function ShopStockTakeDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const detailQuery = useStockTake(id)
  const upsertMutation = useUpsertStockTakeLine()
  const submitMutation = useSubmitStockTake()
  const cancelMutation = useCancelStockTake()

  // Local pending edits — keyed by productId. Cleared per row when the
  // server round-trip returns a matching row (see effect below).
  const [pending, setPending] = useState<Map<string, { counted?: string; note?: string }>>(new Map())
  const debounceHandles = useRef<Map<string, number>>(new Map())

  // Filter + search state
  const [showDiffsOnly, setShowDiffsOnly] = useState(false)
  const [search, setSearch] = useState('')

  // Confirm-dialog state — Submit is a simple confirm, Cancel needs a
  // reason field so it gets its own inline Dialog below.
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelErr, setCancelErr] = useState<string | null>(null)

  const detail: StockTakeDetailDto | undefined = detailQuery.data
  const isDraft = detail?.status === 'Draft'

  // Clear the pending overlay whenever the server data catches up — i.e.
  // the server-returned countedQty matches what we optimistically stored.
  useEffect(() => {
    if (!detail) return
    setPending(prev => {
      if (prev.size === 0) return prev
      const next = new Map(prev)
      let changed = false
      for (const item of detail.items) {
        const edit = next.get(item.productId)
        if (!edit) continue
        const editedCounted = edit.counted != null ? parseFloat(stripAmountFormat(edit.counted)) : undefined
        const editedNote    = edit.note
        const countedMatches = editedCounted == null || (Number.isFinite(editedCounted) && editedCounted === item.countedQty)
        const noteMatches    = editedNote    == null || editedNote === (item.note ?? '')
        if (countedMatches && noteMatches) {
          next.delete(item.productId)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [detail])

  // Cancel any outstanding debounce timers on unmount.
  useEffect(() => {
    return () => {
      for (const h of debounceHandles.current.values()) window.clearTimeout(h)
      debounceHandles.current.clear()
    }
  }, [])

  // ── Rollups (server-side qty_diff, layered with pending edits) ──
  const rowsWithLocal = useMemo(() => {
    if (!detail) return []
    return detail.items.map(item => {
      const edit = pending.get(item.productId)
      const editedCounted = edit?.counted != null && edit.counted !== ''
        ? parseFloat(stripAmountFormat(edit.counted))
        : undefined
      const localCounted = editedCounted != null && Number.isFinite(editedCounted)
        ? editedCounted
        : item.countedQty
      const localNote = edit?.note != null ? edit.note : (item.note ?? '')
      const localDiff = localCounted - item.systemQty
      return { item, localCounted, localDiff, localNote, dirty: !!edit }
    })
  }, [detail, pending])

  const counts = useMemo(() => {
    const total = rowsWithLocal.length
    const diffRows = rowsWithLocal.filter(r => r.localDiff !== 0).length
    const net = rowsWithLocal.reduce((s, r) => s + r.localDiff, 0)
    return { total, diffRows, net }
  }, [rowsWithLocal])

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rowsWithLocal.filter(r => {
      if (showDiffsOnly && r.localDiff === 0) return false
      if (q) {
        const hay = `${r.item.productCode} ${r.item.productName}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rowsWithLocal, showDiffsOnly, search])

  // ── Persist a single line — debounced by productId. ──
  const scheduleUpsert = (productId: string) => {
    const existing = debounceHandles.current.get(productId)
    if (existing) window.clearTimeout(existing)
    const handle = window.setTimeout(() => {
      const edit = pending.get(productId)
      if (!edit || !detail) return
      // Server value if no pending override
      const item = detail.items.find(i => i.productId === productId)
      if (!item) return
      const countedRaw = edit.counted != null && edit.counted !== ''
        ? parseFloat(stripAmountFormat(edit.counted))
        : item.countedQty
      const noteRaw = edit.note != null ? edit.note.trim() : (item.note ?? '')
      if (!Number.isFinite(countedRaw) || countedRaw < 0) return
      upsertMutation.mutate({
        id: detail.id,
        req: {
          productId,
          countedQty: countedRaw,
          note: noteRaw.length === 0 ? null : noteRaw,
        },
      })
    }, UPSERT_DEBOUNCE_MS)
    debounceHandles.current.set(productId, handle)
  }

  const patchPending = (productId: string, patch: { counted?: string; note?: string }) => {
    setPending(prev => {
      const next = new Map(prev)
      const cur = next.get(productId) ?? {}
      next.set(productId, { ...cur, ...patch })
      return next
    })
  }

  const handleCountedChange = (productId: string, raw: string) => {
    const cleaned = stripAmountFormat(raw)
    patchPending(productId, { counted: cleaned })
    scheduleUpsert(productId)
  }

  const handleNoteChange = (productId: string, val: string) => {
    patchPending(productId, { note: val })
    scheduleUpsert(productId)
  }

  const handleSubmit = async () => {
    if (!detail) return
    setSubmitConfirmOpen(false)
    try {
      await submitMutation.mutateAsync(detail.id)
    } catch {
      // Error surfacing handled below via mutation.error
    }
  }

  const handleCancel = async () => {
    if (!detail) return
    if (cancelReason.trim().length < 5) {
      setCancelErr('Reason must be at least 5 characters.')
      return
    }
    setCancelErr(null)
    try {
      await cancelMutation.mutateAsync({ id: detail.id, req: { reason: cancelReason.trim() } })
      setCancelDialogOpen(false)
      setCancelReason('')
    } catch (err) {
      setCancelErr(err instanceof Error ? err.message : 'Failed to cancel.')
    }
  }

  // ── Render ──

  if (detailQuery.isLoading) {
    return (
      <Box className="p-4 sm:p-6">
        <Box sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress size={24} />
        </Box>
      </Box>
    )
  }

  if (detailQuery.error || !detail) {
    return (
      <Box className="p-4 sm:p-6">
        <Alert severity="error" sx={{ borderRadius: 2 }}>
          {detailQuery.error instanceof Error
            ? detailQuery.error.message
            : 'Stock-take not found or not accessible.'}
        </Alert>
        <Button
          onClick={() => navigate('/shop/stock-takes')}
          startIcon={<ArrowLeft size={16} />}
          sx={{ mt: 2, textTransform: 'none', fontWeight: 600 }}
        >
          Back to stock-takes
        </Button>
      </Box>
    )
  }

  const style = STATUS_STYLE[detail.status]
  const netColor = counts.net === 0 ? '#1F1F1F99' : counts.net > 0 ? '#2E7D32' : '#C62828'

  return (
    <Box className="p-4 sm:p-6">
      <PageHeader
        title={`Stock Count · ${detail.code}`}
        subtitle={
          detail.status === 'Draft'
            ? 'Count each SKU on the shelf. Enter the actual quantity — every mismatch will post an inventory adjustment on Submit.'
            : detail.status === 'Submitted'
            ? 'This count was posted. Read-only view.'
            : 'This count was cancelled. Read-only view.'
        }
        action={
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              onClick={() => navigate('/shop/stock-takes')}
              startIcon={<ArrowLeft size={16} />}
              variant="outlined"
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Back
            </Button>
            {isDraft && (
              <>
                <Button
                  onClick={() => setCancelDialogOpen(true)}
                  startIcon={<Ban size={16} />}
                  variant="outlined"
                  color="error"
                  disabled={cancelMutation.isPending || submitMutation.isPending}
                  sx={{ textTransform: 'none', fontWeight: 600 }}
                >
                  Cancel count
                </Button>
                <Button
                  onClick={() => setSubmitConfirmOpen(true)}
                  startIcon={submitMutation.isPending ? <CircularProgress size={14} thickness={5} sx={{ color: 'inherit' }} /> : <Check size={16} />}
                  variant="contained"
                  disabled={submitMutation.isPending || cancelMutation.isPending}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                  {submitMutation.isPending ? 'Submitting…' : 'Submit count'}
                </Button>
              </>
            )}
          </Box>
        }
      />

      {/* Header strip: status + timestamps + rollup pills */}
      <Paper elevation={0} sx={{
        border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835',
        background: '#FFFBE6', borderRadius: 2, mb: 2, p: 2,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Chip
            label={detail.status}
            sx={{
              fontWeight: 700, borderRadius: 999, px: 0.5,
              bgcolor: style.bg, color: style.color, border: `1.5px solid ${style.border}`,
            }}
          />
          <Typography sx={{ fontSize: 13, color: '#1F1F1F99' }}>
            Started <strong style={{ color: '#1F1F1F' }}>{formatIstDateTime(detail.startedAt)}</strong>
          </Typography>
          {detail.submittedAt && (
            <Typography sx={{ fontSize: 13, color: '#1F1F1F99' }}>
              · Submitted <strong style={{ color: '#1F1F1F' }}>{formatIstDateTime(detail.submittedAt)}</strong>
            </Typography>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <RollupPill label="SKUs" value={counts.total} />
          <RollupPill label="Diffs" value={counts.diffRows} />
          <RollupPill label="Net qty" value={counts.net} valueColor={netColor} signed />
        </Box>
      </Paper>

      {/* Filter + search bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search product code or name"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={16} />
                </InputAdornment>
              ),
            },
          }}
          sx={{ flex: 1, minWidth: 320, maxWidth: 480, bgcolor: '#FFFBE6', borderRadius: 1 }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Switch
            size="small"
            checked={showDiffsOnly}
            onChange={(_e, v) => setShowDiffsOnly(v)}
          />
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#1F1F1F' }}>Show only diffs</Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Typography sx={{ fontSize: 12, color: '#1F1F1F99', fontStyle: 'italic' }}>
          Showing {visibleRows.length} of {counts.total}
        </Typography>
      </Box>

      {(submitMutation.error || cancelMutation.error || upsertMutation.error) && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
          {(submitMutation.error || cancelMutation.error || upsertMutation.error) instanceof Error
            ? (submitMutation.error || cancelMutation.error || upsertMutation.error)!.message
            : 'Something went wrong. Try again.'}
        </Alert>
      )}

      {/* Line editor — same visual language as ShopUtilities / ShopRequests
          list tables: white Paper frame, gold header row, cream data rows,
          auto table layout with explicit widths only on the small numeric
          columns so Product flexes naturally to the remaining space. */}
      <Paper elevation={0} sx={{
        borderRadius: 2, border: '2px solid #1F1F1F',
        bgcolor: '#FFFFFF', overflow: 'hidden',
      }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FCD835' }}>
                <TableCell sx={HEAD_SX}>Product</TableCell>
                <TableCell sx={{ ...HEAD_SX, width: 120 }} align="right">System qty</TableCell>
                <TableCell sx={{ ...HEAD_SX, width: 140 }} align="right">Counted qty</TableCell>
                <TableCell sx={{ ...HEAD_SX, width: 100 }} align="right">Diff</TableCell>
                <TableCell sx={{ ...HEAD_SX, width: 80 }}  align="center">Note</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ textAlign: 'center', py: 4, color: '#1F1F1F99' }}>
                    {counts.total === 0
                      ? 'No products in this shop yet.'
                      : showDiffsOnly
                      ? 'No differences found — everything on the shelf matches the system.'
                      : 'No products match your search.'}
                  </TableCell>
                </TableRow>
              ) : (
                visibleRows.map(({ item, localDiff, localNote, dirty }) => (
                  <LineRow
                    key={item.productId}
                    item={item}
                    localDiff={localDiff}
                    localNote={localNote}
                    dirty={dirty}
                    editable={isDraft}
                    onCountedChange={v => handleCountedChange(item.productId, v)}
                    onNoteChange={v => handleNoteChange(item.productId, v)}
                    pendingRaw={pending.get(item.productId)?.counted}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Submit confirmation — uses the shared ConfirmDialog. */}
      <ConfirmDialog
        open={submitConfirmOpen}
        title="Submit stock count?"
        message={
          counts.diffRows === 0
            ? 'No differences to post. Submitting will close this count with zero adjustments — that\'s a valid signal that the shelf matches the system.'
            : `This will post ${counts.diffRows} inventory adjustment${counts.diffRows === 1 ? '' : 's'} (net ${counts.net > 0 ? '+' : ''}${counts.net} qty). Adjustments are irreversible.`
        }
        confirmLabel={submitMutation.isPending ? 'Submitting…' : 'Submit'}
        cancelLabel="Not yet"
        onConfirm={handleSubmit}
        onCancel={() => setSubmitConfirmOpen(false)}
      />

      {/* Cancel with reason. */}
      <Dialog
        open={cancelDialogOpen}
        onClose={(_e, reason) => {
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') return
          setCancelDialogOpen(false)
        }}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3, bgcolor: '#FFFBE6' } } }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>Cancel stock count</DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ fontSize: 13, color: '#1F1F1F99', mb: 2 }}>
            Cancelling discards this session — no inventory adjustments are posted. Enter a short reason for the audit trail.
          </Typography>
          <TextField
            label="Reason"
            value={cancelReason}
            onChange={e => setCancelReason(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            size="small"
            placeholder="e.g. Miscounted several rows — will re-run tomorrow"
            autoFocus
          />
          {cancelErr && <Alert severity="error" sx={{ mt: 2 }}>{cancelErr}</Alert>}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            onClick={() => { setCancelDialogOpen(false); setCancelReason(''); setCancelErr(null) }}
            variant="outlined"
            disabled={cancelMutation.isPending}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Keep count
          </Button>
          <Button
            onClick={handleCancel}
            variant="contained"
            color="error"
            disabled={cancelMutation.isPending}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {cancelMutation.isPending ? 'Cancelling…' : 'Cancel count'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ══════════════════ Row + pill helpers ══════════════════

function RollupPill({ label, value, valueColor, signed = false }: {
  label: string
  value: number
  valueColor?: string
  signed?: boolean
}) {
  const prefix = signed && value > 0 ? '+' : ''
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'baseline', gap: 0.75,
      px: 1.25, py: 0.5, borderRadius: 999,
      bgcolor: 'rgba(31,31,31,0.06)', border: '1px solid rgba(31,31,31,0.15)',
    }}>
      <Typography sx={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: '#1F1F1F99' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 14, fontWeight: 800, color: valueColor ?? '#1F1F1F', fontVariantNumeric: 'tabular-nums' }}>
        {prefix}{value}
      </Typography>
    </Box>
  )
}

function LineRow({
  item, localDiff, localNote, dirty, editable,
  onCountedChange, onNoteChange, pendingRaw,
}: {
  item: StockTakeItemDto
  localDiff: number
  localNote: string
  dirty: boolean
  editable: boolean
  onCountedChange: (v: string) => void
  onNoteChange: (v: string) => void
  /** Raw pending string — when present, overrides display of countedQty so
   *  a mid-typing value like "12." doesn't get reformatted / clamped. */
  pendingRaw?: string
}) {
  const [noteAnchor, setNoteAnchor] = useState<HTMLElement | null>(null)
  const diffColor = localDiff === 0 ? '#1F1F1F55' : localDiff > 0 ? '#2E7D32' : '#C62828'
  const diffPrefix = localDiff > 0 ? '+' : ''
  const displayValue = pendingRaw != null
    ? formatAmountInput(pendingRaw)
    : formatAmountInput(String(item.countedQty))

  return (
    <TableRow hover sx={{ bgcolor: '#FFFBE6' }}>
      <TableCell>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1F1F1F' }}>{item.productName}</Typography>
          <Typography sx={{ fontSize: 11, color: '#1F1F1F99', fontFamily: 'monospace' }}>{item.productCode}</Typography>
        </Box>
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: '#1F1F1F99' }}>
        {item.systemQty}
      </TableCell>
      <TableCell align="right" sx={{ py: 0.5 }}>
        {editable ? (
          <TextField
            type="text"
            size="small"
            value={displayValue}
            onChange={e => onCountedChange(e.target.value)}
            onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault() }}
            onFocus={e => (e.target as HTMLInputElement).select()}
            slotProps={{ htmlInput: {
              inputMode: 'decimal',
              style: { textAlign: 'right', padding: '4px 8px', fontVariantNumeric: 'tabular-nums' },
            } }}
            sx={{
              width: 96,
              '& .MuiOutlinedInput-root': dirty ? {
                '& fieldset': { borderColor: '#C28A00', borderWidth: 1.5 },
              } : undefined,
            }}
          />
        ) : (
          <Typography sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{item.countedQty}</Typography>
        )}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: diffColor }}>
        {diffPrefix}{localDiff}
      </TableCell>
      <TableCell align="center">
        <Tooltip title={localNote ? localNote : (editable ? 'Add a note' : 'No note')} arrow>
          <IconButton
            size="small"
            onClick={e => setNoteAnchor(e.currentTarget)}
            disabled={!editable && !localNote}
            sx={{
              color: localNote ? '#7C4A00' : '#1F1F1F55',
              '&:hover': { bgcolor: 'rgba(252,216,53,0.25)' },
            }}
          >
            <FileText size={16} />
          </IconButton>
        </Tooltip>
        <Popover
          open={!!noteAnchor}
          anchorEl={noteAnchor}
          onClose={() => setNoteAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{ paper: { sx: { p: 2, minWidth: 280, bgcolor: '#FFFBE6' } } }}
        >
          {editable ? (
            <TextField
              label="Note"
              value={localNote}
              onChange={e => onNoteChange(e.target.value)}
              fullWidth
              multiline
              minRows={2}
              size="small"
              placeholder="e.g. 3 packets water-damaged"
              autoFocus
            />
          ) : (
            <Typography sx={{ fontSize: 13, color: '#1F1F1F', whiteSpace: 'pre-wrap' }}>
              {localNote || <em style={{ color: '#1F1F1F55' }}>No note</em>}
            </Typography>
          )}
        </Popover>
      </TableCell>
    </TableRow>
  )
}
