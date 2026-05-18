import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, PackageCheck, Check, Printer, X, Undo2 } from 'lucide-react'
import {
  Alert, Badge, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import { DispatchedCell } from '../../components/DispatchedCell'
import { RequestSummary } from '../../components/RequestSummary'
import { formatINR } from '../../utils/format'
import {
  useStockRequest, useDispatchStockRequest,
  useApproveStockRequest, useRejectStockRequest, useRevokeStockRequest,
} from '../../hooks/useStockRequests'
import type { RequestStatus } from '../../api/stock-requests/types'
import { ValidationError } from '../../api/errors'

const STATUS_COLOR: Record<RequestStatus, 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
  Pending: 'warning', Approved: 'info', Rejected: 'error',
  Dispatched: 'primary', Received: 'success', Cancelled: 'default',
}

const fmtIst = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '—'

const fmtShort = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

export default function InventoryRequestDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: request, isLoading, error } = useStockRequest(id)
  const dispatchMutation = useDispatchStockRequest()
  const approveMutation  = useApproveStockRequest()
  const rejectMutation   = useRejectStockRequest()
  const revokeMutation   = useRevokeStockRequest()

  // Per-item "to dispatch" quantities. Starts at requested_qty; inventory can
  // ship less if they're out of stock (clamped to ≤ requested_qty).
  const [dispatchQtys, setDispatchQtys] = useState<Map<string, number>>(new Map())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [approveConfirm, setApproveConfirm] = useState(false)
  const [rejectOpen, setRejectOpen]   = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [revokeConfirm, setRevokeConfirm] = useState(false)

  // Seed dispatchQtys from items when the request loads (only for Approved requests).
  useEffect(() => {
    if (!request) return
    if (request.status !== 'Approved') {
      setDispatchQtys(new Map())
      return
    }
    const map = new Map<string, number>()
    for (const item of request.items ?? []) {
      map.set(item.id, item.dispatchedQty ?? item.requestedQty)
    }
    setDispatchQtys(map)
  }, [request])

  // Stats surfaced in the sticky bottom bar. Declared before any early return
  // so React's hooks order stays stable across renders.
  const items = request?.items ?? []
  // Approval step removed: a freshly submitted Pending request is dispatchable.
  // Approved kept as fallback for legacy rows from before the workflow change.
  const canDispatch = request?.status === 'Pending' || request?.status === 'Approved'
  const stats = useMemo(() => {
    let dispatchTotal = 0
    let shortLines = 0
    for (const it of items) {
      const q = dispatchQtys.get(it.id) ?? it.requestedQty
      dispatchTotal += q * it.unitPrice
      if (q < it.requestedQty) shortLines++
    }
    return { dispatchTotal, shortLines }
  }, [items, dispatchQtys])

  // Inventory user must enter a number on every line before dispatching (0
  // is fine — that's an out-of-stock declaration). An empty input removes
  // the entry from dispatchQtys, so a missing key = not filled in.
  const allLinesFilled = items.length > 0 && items.every(it => dispatchQtys.has(it.id))

  if (isLoading) return <Box><PageHeader title="Loading…" subtitle="" /></Box>
  if (error || !request) {
    return (
      <Box>
        <PageHeader title="Request not found" subtitle="" action={<BackButton onClick={() => navigate('/inventory/requests')} />} />
        <Alert severity="error">{error instanceof Error ? error.message : 'Could not load request.'}</Alert>
      </Box>
    )
  }

  const setItemQty = (itemId: string, raw: string, requestedQty: number) => {
    // Empty field = clear the override. The dispatch payload (and the line
    // total) then falls back to requested_qty for that item. This is what
    // lets the user erase the existing number and re-type — if we stored 0
    // here, the field would re-render as "0" and trap the user.
    if (raw === '') {
      setDispatchQtys(prev => { const n = new Map(prev); n.delete(itemId); return n })
      return
    }
    const n = parseInt(raw, 10)
    if (Number.isNaN(n) || n < 0) return
    // Clamp to requested qty (DB constraint enforces this too).
    const clamped = Math.min(n, requestedQty)
    setDispatchQtys(prev => { const m = new Map(prev); m.set(itemId, clamped); return m })
  }

  const handleDispatch = async () => {
    const itemsPayload = items.map(it => ({
      id: it.id,
      dispatchedQty: dispatchQtys.get(it.id) ?? it.requestedQty,
    }))
    try {
      await dispatchMutation.mutateAsync({ id: request.id, req: { items: itemsPayload } })
    } finally {
      setConfirmOpen(false)
    }
  }

  const handleApprove = async () => {
    try { await approveMutation.mutateAsync(request.id) }
    finally { setApproveConfirm(false) }
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) return
    try {
      await rejectMutation.mutateAsync({ id: request.id, req: { reason: rejectReason.trim() } })
      setRejectOpen(false)
      setRejectReason('')
    } catch {/* error shown below */}
  }

  const handleRevoke = async () => {
    try { await revokeMutation.mutateAsync(request.id) }
    finally { setRevokeConfirm(false) }
  }

  // Approve/Reject buttons appear only when the request is still Pending.
  // Revoke appears only when the request is Approved or Rejected — once
  // it's Dispatched there's no going back.
  // Once status moves out of Pending, the shop's edit window is implicitly
  // closed (shop UI keys off status === 'Pending').
  const canApproveOrReject = request.status === 'Pending'
  const canRevoke          = request.status === 'Approved' || request.status === 'Rejected'

  const flatErr = (e: unknown) =>
    e instanceof ValidationError ? e.flatten()
    : e instanceof Error ? e.message
    : null
  const dispatchError = flatErr(dispatchMutation.error)
  const approveError  = flatErr(approveMutation.error)
  const rejectError   = flatErr(rejectMutation.error)
  const revokeError   = flatErr(revokeMutation.error)

  return (
    <Box sx={{ pb: canDispatch ? 12 : 4 }}>
      <PageHeader
        title={request.code}
        subtitle={`${request.shopCode} ${request.shopName} — pack & dispatch`}
        action={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {canApproveOrReject && (
              <>
                <Button
                  variant="outlined"
                  startIcon={<X className="w-4 h-4" />}
                  onClick={() => setRejectOpen(true)}
                  disabled={rejectMutation.isPending}
                  sx={{
                    textTransform: 'none', fontWeight: 600,
                    borderColor: '#C62828', color: '#C62828',
                    '&:hover': { borderColor: '#C62828', bgcolor: 'rgba(198,40,40,0.05)' },
                  }}
                >
                  Reject
                </Button>
                <Button
                  variant="contained"
                  color="success"
                  startIcon={<Check className="w-4 h-4" />}
                  onClick={() => setApproveConfirm(true)}
                  disabled={approveMutation.isPending}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                  Approve
                </Button>
              </>
            )}
            {canRevoke && (
              <Button
                variant="outlined"
                startIcon={<Undo2 className="w-4 h-4" />}
                onClick={() => setRevokeConfirm(true)}
                disabled={revokeMutation.isPending}
                sx={{
                  textTransform: 'none', fontWeight: 600,
                  borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFFFFF',
                  '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
                }}
              >
                Revoke
              </Button>
            )}
            <Button
              variant="outlined"
              startIcon={<Printer className="w-4 h-4" />}
              onClick={() => window.open(`/print/request/${request.id}`, '_blank', 'noopener,noreferrer')}
              sx={{
                textTransform: 'none', fontWeight: 600,
                borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFFFFF',
                '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
              }}
            >
              Print
            </Button>
            <BackButton onClick={() => navigate('/inventory/requests')} />
          </Box>
        }
      />

      {/* Status row + horizontal pill timeline */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2, alignItems: 'center' }}>
        <Chip
          label={request.status}
          color={STATUS_COLOR[request.status]}
          variant={request.status === 'Received' ? 'filled' : 'outlined'}
          size="small"
          sx={{ fontWeight: 700 }}
        />
        {canDispatch && (
          <Chip label="Ready to dispatch" color="primary" variant="outlined" size="small" />
        )}

        <Box sx={{ flex: 1 }} />

        {/* Approval step removed — Submitted → Dispatched → Received. */}
        <PillStep label="Submitted"  at={request.submittedAt}  by={request.submittedByName}  done />
        <PillSep />
        <PillStep label="Dispatched" at={request.dispatchedAt} by={request.dispatchedByName} done={!!request.dispatchedAt} />
        <PillSep />
        <PillStep label="Received"   at={request.receivedAt}   by={request.receivedByName}  done={!!request.receivedAt} />
      </Box>

      {/* Items table — input column changes based on status */}
      <Paper elevation={0} sx={{ mb: 2, borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFFFFF', overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FCD835' }}>
                <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11 }}>Product</TableCell>
                <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, width: 100 }} align="right">Weight</TableCell>
                <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, width: 90 }} align="right">Requested</TableCell>
                <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, width: 130 }} align="center">
                  {canDispatch ? 'Dispatch Qty' : 'Dispatched'}
                </TableCell>
                <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, width: 100 }} align="right">Unit Price</TableCell>
                <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, width: 110 }} align="right">Subtotal</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map(item => {
                const currentDispatch = dispatchQtys.get(item.id) ?? item.dispatchedQty ?? item.requestedQty
                const lineTotal = currentDispatch * item.unitPrice
                const isShort = canDispatch && currentDispatch < item.requestedQty
                return (
                  <TableRow key={item.id} hover>
                    <TableCell sx={{ py: 0.75 }}>
                      <Box sx={{ fontWeight: 600, fontSize: 13 }}>{item.productCode} — {item.productName}</Box>
                    </TableCell>
                    <TableCell align="right" sx={{ py: 0.75 }}>
                      {item.weightValue != null
                        ? `${item.weightValue} ${item.weightUnit ?? ''}`.trim()
                        : <span className="text-[#1F1F1F]/40">—</span>}
                    </TableCell>
                    <TableCell align="right" sx={{ py: 0.75 }}>{item.requestedQty}</TableCell>
                    <TableCell align="center" sx={{ py: 0.5 }}>
                      {canDispatch ? (
                        <TextField
                          type="number"
                          size="small"
                          value={dispatchQtys.get(item.id) ?? ''}
                          onChange={e => setItemQty(item.id, e.target.value, item.requestedQty)}
                          onKeyDown={e => { if (['e', 'E', '+', '-', '.', ','].includes(e.key)) e.preventDefault() }}
                          slotProps={{ htmlInput: { min: 0, max: item.requestedQty, inputMode: 'numeric', style: { textAlign: 'center', padding: '4px 8px' } } }}
                          sx={{
                            width: 86,
                            '& .MuiOutlinedInput-root': {
                              bgcolor: isShort ? '#FFEBEE' : '#FFF8DC',
                              '& fieldset': { borderColor: isShort ? '#C62828' : '#1F1F1F' },
                            },
                          }}
                        />
                      ) : (
                        <DispatchedCell qty={item.dispatchedQty} requested={item.requestedQty} />
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ py: 0.75 }}>{formatINR(item.unitPrice)}</TableCell>
                    <TableCell align="right" sx={{ py: 0.75, fontWeight: 600 }}>{formatINR(lineTotal)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Summary panel — overall totals broken out for clarity.
          Pre-dispatch editing flow keeps live numbers in the sticky bottom bar. */}
      <Box sx={{ mb: 2 }}>
        <RequestSummary request={request} />
      </Box>

      {request.notes && (
        <Paper elevation={0} sx={{ p: 1.5, mb: 2, borderRadius: 2, bgcolor: '#FFF8DC', border: '1px dashed #1F1F1F' }}>
          <Box sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', mb: 0.5 }}>Shop's Notes</Box>
          <Box sx={{ fontSize: 14, color: '#1F1F1F', whiteSpace: 'pre-wrap' }}>{request.notes}</Box>
        </Paper>
      )}

      {dispatchError && <Alert severity="error" sx={{ mb: 1, whiteSpace: 'pre-line' }}>{dispatchError}</Alert>}
      {approveError  && <Alert severity="error" sx={{ mb: 1, whiteSpace: 'pre-line' }}>{approveError}</Alert>}
      {rejectError   && <Alert severity="error" sx={{ mb: 1, whiteSpace: 'pre-line' }}>{rejectError}</Alert>}
      {revokeError   && <Alert severity="error" sx={{ mb: 1, whiteSpace: 'pre-line' }}>{revokeError}</Alert>}

      {/* Sticky bottom dispatch bar — only when this request is dispatchable. */}
      {canDispatch && (
        <Paper
          elevation={6}
          sx={{
            position: 'fixed',
            bottom: 0,
            left: { xs: 0, lg: 256 /* sidebar width */ },
            right: 0,
            zIndex: 20,
            borderRadius: 0,
            borderTop: '2px solid #1F1F1F',
            bgcolor: '#FFFFFF',
            px: { xs: 2, sm: 3 },
            py: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            flexWrap: 'wrap',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
            <Badge badgeContent={stats.shortLines} color="error" max={99} invisible={stats.shortLines === 0}>
              <PackageCheck className="w-5 h-5 text-[#1F1F1F]" />
            </Badge>
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ fontSize: 13, color: '#1F1F1F99' }}>
                {!allLinesFilled
                  ? `Enter qty for ${items.length - dispatchQtys.size} more line${items.length - dispatchQtys.size === 1 ? '' : 's'}`
                  : stats.shortLines > 0
                    ? `${stats.shortLines} line${stats.shortLines === 1 ? '' : 's'} short of requested`
                    : 'All lines at requested qty'}
              </Box>
              <Box sx={{ fontSize: 18, fontWeight: 700, color: '#1F1F1F' }}>Dispatch total {formatINR(stats.dispatchTotal)}</Box>
            </Box>
          </Box>
          <Button
            variant="contained"
            startIcon={<PackageCheck className="w-4 h-4" />}
            onClick={() => setConfirmOpen(true)}
            disabled={dispatchMutation.isPending || !allLinesFilled}
            title={!allLinesFilled ? 'Enter a quantity for every product first (0 = out of stock)' : undefined}
            sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}
          >
            {dispatchMutation.isPending ? 'Dispatching…' : 'Mark as Dispatched'}
          </Button>
        </Paper>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Confirm dispatch?"
        message={`Mark ${request.code} as Dispatched with the quantities entered (total ${formatINR(stats.dispatchTotal)}). The shop will then be able to confirm receipt.`}
        confirmLabel="Yes, Dispatch"
        cancelLabel="Not yet"
        onConfirm={handleDispatch}
        onCancel={() => setConfirmOpen(false)}
      />

      <ConfirmDialog
        open={approveConfirm}
        title="Approve this request?"
        message={`Approving ${request.code} locks the request — the shop can no longer edit it. You can still adjust dispatch quantities when you mark it Dispatched.`}
        confirmLabel="Yes, Approve"
        cancelLabel="Not yet"
        onConfirm={handleApprove}
        onCancel={() => setApproveConfirm(false)}
      />

      <ConfirmDialog
        open={revokeConfirm}
        title={`Revoke ${request.status === 'Approved' ? 'approval' : 'rejection'}?`}
        message={
          request.status === 'Approved'
            ? `This sends ${request.code} back to Pending. The shop will be able to edit it again, and you'll need to Approve (or Reject) before dispatch.`
            : `This sends ${request.code} back to Pending and clears the rejection reason. The shop will see it as a fresh request again.`
        }
        confirmLabel="Yes, Revoke"
        cancelLabel="Not yet"
        onConfirm={handleRevoke}
        onCancel={() => setRevokeConfirm(false)}
      />

      {/* Reject dialog — reason required (BE enforces too). */}
      <Dialog
        open={rejectOpen}
        onClose={(_e, reason) => { if (reason === 'backdropClick' || rejectMutation.isPending) return; setRejectOpen(false) }}
        maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600 }}>
          Reject Request
          <IconButton size="small" onClick={() => setRejectOpen(false)} disabled={rejectMutation.isPending}>
            <X className="w-4 h-4" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ fontSize: 13, color: '#1F1F1F99' }}>
            The shop will see this reason on their request. Be specific so they can fix and resubmit.
          </Box>
          <TextField
            label="Rejection reason"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value.slice(0, 500))}
            multiline minRows={3} required size="small" autoFocus
            placeholder="e.g. Stock not available — please request next week"
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setRejectOpen(false)} variant="outlined" color="secondary" disabled={rejectMutation.isPending} sx={{ textTransform: 'none', fontWeight: 500 }}>
            Cancel
          </Button>
          <Button onClick={handleReject} variant="contained" color="error" disabled={!rejectReason.trim() || rejectMutation.isPending} sx={{ textTransform: 'none', fontWeight: 600 }}>
            {rejectMutation.isPending ? 'Rejecting…' : 'Reject Request'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ───────────────────────────────────────────────────────────────

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outlined" startIcon={<ArrowLeft className="w-4 h-4" />} onClick={onClick}
      sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFFFFF', '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' } }}>
      Back to list
    </Button>
  )
}

// One step in the horizontal mini-timeline.
function PillStep({ label, at, by, done }: { label: string; at: string | null | undefined; by?: string | null; done: boolean }) {
  const tooltip = `${fmtIst(at)}${done && by ? ` · by ${by}` : ''}`
  return (
    <Chip
      title={tooltip}
      icon={done ? <Check className="w-3.5 h-3.5" /> : undefined}
      label={
        <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
          <Box sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, opacity: done ? 1 : 0.6 }}>{label}</Box>
          <Box sx={{ fontSize: 11, opacity: done ? 0.8 : 0.4 }}>{done ? fmtShort(at) : '—'}</Box>
          {done && by && (
            <Box sx={{ fontSize: 10, opacity: 0.7, fontStyle: 'italic' }}>by {by}</Box>
          )}
        </Box>
      }
      size="small"
      sx={{
        height: 'auto',
        py: 0.5,
        px: 0.5,
        borderRadius: 1,
        bgcolor: done ? '#FFF8DC' : 'rgba(31,31,31,0.04)',
        border: '1px solid',
        borderColor: done ? '#FCD835' : 'rgba(31,31,31,0.12)',
        color: '#1F1F1F',
        '& .MuiChip-icon': { color: '#1F1F1F' },
        '& .MuiChip-label': { px: 0.75 },
      }}
    />
  )
}

function PillSep() {
  return <Box sx={{ width: 18, height: 1, bgcolor: 'rgba(31,31,31,0.25)' }} />
}
