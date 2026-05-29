import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, PackageCheck, Check, Printer, X, Undo2 } from 'lucide-react'
import {
  Alert, Badge, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Paper, Table, TableBody, TableCell, TableContainer,
  TableRow, TextField,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import { DispatchedCell } from '../../components/DispatchedCell'
import { RequestSummary } from '../../components/RequestSummary'
import { formatINR } from '../../utils/format'
import { formatIstDateTime, formatIstTime } from '../../utils/formatDate'
import {
  useStockRequest, useDispatchStockRequest,
  useApproveStockRequest, useRejectStockRequest, useRevokeStockRequest,
  useSaveDispatchDraft, useClearDispatchDraft,
  useAcceptReturn,
} from '../../hooks/useStockRequests'
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
import { UnsavedChangesDialog } from '../../components/UnsavedChangesDialog'
import type { RequestStatus } from '../../api/stock-requests/types'
import { ValidationError } from '../../api/errors'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'

const STATUS_COLOR: Record<RequestStatus, 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
  // Inventory never sees Draft requests (BE excludes them from /incoming).
  // Mapping kept to satisfy the exhaustive Record type.
  Draft: 'default',
  Pending: 'warning', Approved: 'info', Rejected: 'error',
  Dispatched: 'primary', Received: 'success', Cancelled: 'default',
  // Returns' terminal state — green-success once goods are back at godown.
  Accepted: 'success',
}

export default function InventoryRequestDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: request, isLoading, error } = useStockRequest(id)
  const dispatchMutation     = useDispatchStockRequest()
  const approveMutation      = useApproveStockRequest()
  const rejectMutation       = useRejectStockRequest()
  const revokeMutation       = useRevokeStockRequest()
  const saveDraftMutation    = useSaveDispatchDraft()
  const clearDraftMutation   = useClearDispatchDraft()
  // Accept Return — Pending Return → Accepted (terminal). Same per-item qty
  // payload as Dispatch but writes acceptedQty (BE maps to dispatched_qty
  // column; partial accept allowed if godown counts less).
  const acceptReturnMutation = useAcceptReturn()

  // Per-item "to dispatch" quantities. Starts at requested_qty; inventory can
  // ship less if they're out of stock (clamped to ≤ requested_qty).
  const [dispatchQtys, setDispatchQtys] = useState<Map<string, number>>(new Map())
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null)
  // True when dispatch qtys have changed since the last successful draft
  // save (or since the seed from a stored draft). Drives the Save as Draft
  // button's disabled state so the user can't redundantly re-save the
  // same data.
  const [isDraftDirty, setIsDraftDirty] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [approveConfirm, setApproveConfirm] = useState(false)
  const [rejectOpen, setRejectOpen]   = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [revokeConfirm, setRevokeConfirm] = useState(false)

  // Seed dispatchQtys from items when the request loads. Priority order:
  //   1. draftDispatchedQty  — inventory user's saved WIP from a previous visit
  //   2. dispatchedQty       — legacy data where the qty was already set
  //   3. requestedQty default — only for Approved (post-approval auto-fill,
  //                             matches the pre-draft "ready to dispatch" UX)
  //   4. (none)              — empty input; user has to type each line
  //                            (Pending without a saved draft)
  //
  // isDraftDirty:
  //   - false when the seed came from BE-persisted values (draft / dispatched)
  //     — what's in memory matches what's saved, so Save as Draft greys out.
  //   - true when the seed came from the requestedQty default — those are
  //     unsaved fresh defaults, so both Save as Draft AND Mark as Dispatched
  //     light up after Approve, per the inventory workflow.
  useEffect(() => {
    if (!request) return
    const status = request.status
    const isDispatchable = status === 'Pending' || status === 'Approved'
    if (!isDispatchable) {
      setDispatchQtys(new Map())
      setIsDraftDirty(false)
      return
    }
    const map = new Map<string, number>()
    let seededAsUnsavedDefaults = false
    for (const item of request.items ?? []) {
      if (item.draftDispatchedQty != null) {
        map.set(item.id, item.draftDispatchedQty)
      } else if (item.dispatchedQty != null) {
        map.set(item.id, item.dispatchedQty)
      } else if (status === 'Approved') {
        // Approved-state default: every line at full requested qty so the
        // godown can dispatch immediately. User can dial individual lines
        // down (e.g. out-of-stock) before clicking Mark as Dispatched.
        map.set(item.id, item.requestedQty)
        seededAsUnsavedDefaults = true
      }
      // Pending without a draft → no seed → input stays empty.
    }
    setDispatchQtys(map)
    setIsDraftDirty(seededAsUnsavedDefaults)
  }, [request])

  // Stats surfaced in the sticky bottom bar. Declared before any early return
  // so React's hooks order stays stable across renders.
  const items = request?.items ?? []
  // Approval step removed: a freshly submitted Pending request is dispatchable.
  // Approved kept as fallback for legacy rows from before the workflow change.
  // Lifecycle flags split by request type. Orders go through Approve →
  // Dispatch → Received; Returns go Pending → Accepted in one step. Reject is
  // valid for either type while still Pending.
  const isReturn   = request?.requestType === 'Return'
  const canDispatch = !isReturn && (request?.status === 'Pending' || request?.status === 'Approved')
  const canAccept   =  isReturn && request?.status === 'Pending'
  // The qty-input table is editable in either pre-finalisation mode.
  const canEditQty  = canDispatch || canAccept
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

  // Card-per-category grouping. Computed unconditionally so hooks order
  // stays stable across loading / error renders.
  const grouped = useMemo(
    () => groupByCategoryWeight(
      items,
      it => ({ category: it.categoryName, weightValue: it.weightValue, weightUnit: it.weightUnit }),
    ),
    [items],
  )

  // Layout note: cards go into a CSS `column-count` container below — the
  // browser auto-balances them across 2 columns (1 on mobile) so column
  // heights stay close. break-inside: avoid keeps each card whole.

  // ── Hooks below MUST stay before the early-return block. React's rules
  //    of hooks demand a stable count per render; if we run only the hooks
  //    above on the loading render and these too on the loaded render,
  //    React throws "Rendered more hooks than during the previous render". ──

  // Unsaved-changes guard — fires when the user tries to leave the dispatch
  // screen with dirty qtys (in-app nav like clicking Back to list, sidebar
  // menu, or browser refresh / back / tab close). Only active while the
  // request is dispatchable; once Dispatched/Received/Cancelled there's no
  // draft concept and no editable state to protect.
  //
  // submittingRef bypasses the guard during finalising mutations (dispatch,
  // approve, reject, revoke, receive, cancel) where the navigation that
  // follows is the intended outcome of the user's click.
  const submittingRef = useRef(false)
  const guard = useUnsavedChangesGuard(
    // Guard active for both Order dispatch and Return accept — either flow has
    // editable qtys that get lost if the user navigates away mid-entry.
    () => !submittingRef.current && (canDispatch || canAccept) && isDraftDirty,
  )

  // Auto-save change counter — see ShopRequestNew for the rationale. Used
  // to prevent the post-save dirty-clear from racing with mid-flight edits.
  const changeCountRef = useRef(0)

  // Auto-save dispatch draft 1.5s after the user stops typing. Same debounce
  // pattern as the shop side — cleanup cancels the pending timer on every
  // change, so continuous typing doesn't spam the BE.
  useEffect(() => {
    if (!canDispatch || !isDraftDirty || dispatchQtys.size === 0) return
    // request can be undefined on the very first render before the query
    // resolves; canDispatch evaluates to false in that case so we're
    // already returning above, but the optional chain below is defensive.
    const requestId = request?.id
    if (!requestId) return

    const timer = setTimeout(() => {
      const startCount = changeCountRef.current
      // Only save items the user has actually typed for — otherwise the
      // `?? requestedQty` fallback used to silently pre-fill every other
      // item with its full requested qty, which then re-seeded on next
      // visit and made it look like the user had filled everything in.
      const itemsPayload = items
        .filter(it => dispatchQtys.has(it.id))
        .map(it => ({ id: it.id, dispatchedQty: dispatchQtys.get(it.id)! }))
      if (itemsPayload.length === 0) return   // nothing to save
      saveDraftMutation.mutate(
        { id: requestId, req: { items: itemsPayload } },
        {
          onSuccess: () => {
            setDraftSavedAt(new Date())
            if (changeCountRef.current === startCount) {
              setIsDraftDirty(false)
            }
          },
          // onError: silent — manual Save as Draft remains available, and the
          // saveDraftError alert above the sticky bar surfaces the BE message.
        },
      )
    }, 1500)

    return () => clearTimeout(timer)
    // saveDraftMutation / items / request deliberately not in deps — see the
    // shop-side auto-save effect for the rationale (re-renders would reset
    // the debounce on every keystroke).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDispatch, isDraftDirty, dispatchQtys])

  if (isLoading) return <Box><PageHeader title="Loading…" subtitle="" /></Box>
  if (error || !request) {
    return (
      <Box>
        <PageHeader title="Request not found" subtitle="" action={<BackButton onClick={() => navigate('/inventory/requests')} />} />
        <Alert severity="error">{error instanceof Error ? error.message : 'Could not load request.'}</Alert>
      </Box>
    )
  }

  const setItemQty = (itemId: string, raw: string, _requestedQty: number) => {
    // Any user-driven change marks the draft as having unsaved changes,
    // re-enabling the Save as Draft button.
    setIsDraftDirty(true)
    changeCountRef.current += 1
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
    // Upper-bound cap removed — inventory can dispatch any positive qty,
    // even above requested_qty (forced case-sizes, rounding up, etc.).
    setDispatchQtys(prev => { const m = new Map(prev); m.set(itemId, n); return m })
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

  // Accept Return — same payload mechanics as Dispatch but the API DTO uses
  // `acceptedQty` (BE maps to dispatched_qty column underneath).
  const handleAccept = async () => {
    const itemsPayload = items.map(it => ({
      id: it.id,
      acceptedQty: dispatchQtys.get(it.id) ?? it.requestedQty,
    }))
    try {
      await acceptReturnMutation.mutateAsync({ id: request.id, req: { items: itemsPayload } })
    } finally {
      setConfirmOpen(false)
    }
  }

  /**
   * Save what's been entered so far without finalising. Lines that the user
   * hasn't typed in yet are sent as their requested_qty so the BE's
   * non-null constraint on the draft column isn't tripped — those values
   * are easy to overwrite when the user returns.
   *
   * Save-as-Draft has NO "all lines filled" gate (unlike Mark-as-Dispatched).
   * The whole point of a draft is that it's incomplete.
   */
  const handleSaveDraft = async () => {
    const startCount = changeCountRef.current
    // Same filter as the auto-save effect — only send items the user has
    // typed for, never a requestedQty default for untouched items.
    const itemsPayload = items
      .filter(it => dispatchQtys.has(it.id))
      .map(it => ({ id: it.id, dispatchedQty: dispatchQtys.get(it.id)! }))
    if (itemsPayload.length === 0) return
    try {
      await saveDraftMutation.mutateAsync({ id: request.id, req: { items: itemsPayload } })
      setDraftSavedAt(new Date())
      // Only mark clean if no in-flight edit happened during the save (same
      // race-protection as the auto-save effect above).
      if (changeCountRef.current === startCount) {
        setIsDraftDirty(false)
      }
    } catch {
      // surfaced via the error alert below
    }
  }

  /**
   * Discard the saved dispatch draft. The BE clears draft_dispatched_qty on
   * every item; the refreshed request flows back into the useEffect seed,
   * which then re-applies the appropriate defaults (empty for Pending,
   * requestedQty for Approved).
   */
  const handleDiscardDraft = async () => {
    try {
      await clearDraftMutation.mutateAsync(request.id)
      setDraftSavedAt(null)
      // The useEffect seeded the new state from the refreshed cache — leave
      // isDraftDirty to it (seed sets it based on what's there now).
    } catch {
      // surfaced via the error alert below
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

  // Approve / Reject / Revoke gates. Returns don't have an Approve step —
  // they go Pending → Accepted directly — but Reject IS valid for either
  // type. Revoke is Order-only (Returns have no Approved intermediate state).
  const canApprove = !isReturn && request.status === 'Pending'
  const canReject  = request.status === 'Pending'
  const canRevoke  = !isReturn && (request.status === 'Approved' || request.status === 'Rejected')

  const flatErr = (e: unknown) =>
    e instanceof ValidationError ? e.flatten()
    : e instanceof Error ? e.message
    : null
  const dispatchError   = flatErr(dispatchMutation.error)
  const acceptError     = flatErr(acceptReturnMutation.error)
  const approveError    = flatErr(approveMutation.error)
  const rejectError     = flatErr(rejectMutation.error)
  const revokeError     = flatErr(revokeMutation.error)
  const saveDraftError  = flatErr(saveDraftMutation.error)
  const clearDraftError = flatErr(clearDraftMutation.error)

  // Was this request opened with a previously-saved draft? Used to surface
  // a quiet "Draft restored" hint until the user explicitly saves again.
  const hasInitialDraft = items.some(it => it.draftDispatchedQty != null)

  // ── guard / submittingRef / changeCountRef / auto-save useEffect all
  //    moved above the isLoading early return (see top of the component)
  //    to keep React's hooks order stable across loading / loaded renders. ──

  // Card renderer for one category-group — same JSX used by both columns
  // of the 2-col grid. Closes over dispatchQtys / canEditQty / setItemQty
  // / formatINR / DispatchedCell from the outer scope.
  const renderCatGroup = (catGroup: typeof grouped[number]) => (
    <Paper
      key={catGroup.category}
      elevation={0}
      sx={{ mb: 2, borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFFFFF', overflow: 'hidden' }}
    >
      {/* Category header — metallic gold gradient with dark text. */}
      <Box
        sx={{
          background: 'linear-gradient(90deg, #C28A00 0%, #E6B800 35%, #FFD700 65%, #FFF1A6 100%)',
          color: '#1F1F1F',
          borderBottom: '2px solid #1F1F1F',
          px: 2,
          py: 1.25,
          fontWeight: 800,
          fontSize: 14,
          textTransform: 'uppercase',
          letterSpacing: 0.8,
        }}
      >
        {catGroup.category}
      </Box>
      <TableContainer>
        <Table size="small">
          <TableBody>
            {catGroup.weightGroups.map((wg, wIdx) => (
              <Fragment key={`${catGroup.category}__${wg.label}`}>
                <TableRow>
                  <TableCell
                    colSpan={5}
                    sx={{
                      bgcolor: '#FFF8DC',
                      borderLeft: '4px solid #FCD835',
                      borderTop: wIdx === 0 ? 'none' : '2px solid #1F1F1F',
                      pl: 2,
                      py: 1,
                      fontWeight: 700,
                      fontSize: 12,
                      textTransform: 'uppercase',
                      letterSpacing: 0.6,
                      color: '#1F1F1F',
                    }}
                  >
                    {wg.label}
                    <Box component="span" sx={{ ml: 1, color: '#1F1F1F99', fontWeight: 600 }}>
                      · {wg.items.length} {wg.items.length === 1 ? 'product' : 'products'}
                    </Box>
                  </TableCell>
                </TableRow>
                {wg.items.map(item => {
                  const currentDispatch = dispatchQtys.get(item.id) ?? item.dispatchedQty ?? item.requestedQty
                  const lineTotal = currentDispatch * item.unitPrice
                  const isShort = canEditQty && currentDispatch < item.requestedQty
                  return (
                    <TableRow key={item.id} hover>
                      <TableCell sx={{ pl: 3, py: 1 }}>
                        <Box sx={{ fontWeight: 600, fontSize: 14 }}>{item.productName}</Box>
                      </TableCell>
                      <TableCell align="right" sx={{ py: 1, width: 90 }}>{item.requestedQty}</TableCell>
                      <TableCell align="center" sx={{ py: 0.5, width: 130 }}>
                        {canEditQty ? (
                          <TextField
                            type="number"
                            size="small"
                            value={dispatchQtys.get(item.id) ?? ''}
                            onChange={e => setItemQty(item.id, e.target.value, item.requestedQty)}
                            onKeyDown={e => { if (['e', 'E', '+', '-', '.', ','].includes(e.key)) e.preventDefault() }}
                            slotProps={{ htmlInput: { min: 0, inputMode: 'numeric', style: { textAlign: 'center', padding: '4px 8px' } } }}
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
                      <TableCell align="right" sx={{ py: 1, width: 100 }}>{formatINR(item.unitPrice)}</TableCell>
                      <TableCell align="right" sx={{ py: 1, width: 110, fontWeight: 600 }}>{formatINR(lineTotal)}</TableCell>
                    </TableRow>
                  )
                })}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  )

  return (
    <Box sx={{ pb: canEditQty ? 12 : 4 }}>
      <PageHeader
        title={request.code}
        subtitle={`${request.shopCode} ${request.shopName} — ${isReturn ? 'review & accept return' : 'pack & dispatch'}`}
        action={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {/* Reject — valid for both Orders and Returns while Pending. */}
            {canReject && (
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
            )}
            {/* Approve — Orders only. Returns don't have an Approve step;
                they go straight from Pending to Accepted. */}
            {canApprove && (
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
          variant={request.status === 'Received' || request.status === 'Accepted' ? 'filled' : 'outlined'}
          size="small"
          sx={{ fontWeight: 700 }}
        />
        {/* Return-type pill — matches the red Return styling on the lists. */}
        {isReturn && (
          <Chip
            label="Return"
            size="small"
            variant="outlined"
            sx={{
              borderColor: '#C62828',
              color: '#C62828',
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          />
        )}
        {canDispatch && (
          <Chip label="Ready to dispatch" color="primary" variant="outlined" size="small" />
        )}
        {canAccept && (
          <Chip label="Ready to accept" color="primary" variant="outlined" size="small" />
        )}

        <Box sx={{ flex: 1 }} />

        {/* Timeline pills — Orders go Submitted → Dispatched → Received; Returns
            go Submitted → Accepted in one step (no approve/dispatch/receive). */}
        <PillStep label="Submitted"  at={request.submittedAt}  by={request.submittedByName}  done />
        <PillSep />
        {isReturn ? (
          <PillStep label="Accepted" at={request.acceptedAt} by={request.acceptedByName} done={!!request.acceptedAt} />
        ) : (
          <>
            <PillStep label="Dispatched" at={request.dispatchedAt} by={request.dispatchedByName} done={!!request.dispatchedAt} />
            <PillSep />
            <PillStep label="Received"   at={request.receivedAt}   by={request.receivedByName}  done={!!request.receivedAt} />
          </>
        )}
      </Box>

      {/* Items — CSS column-count masonry; cards auto-balanced. */}
      <Box
        sx={{
          columnCount: { xs: 1, md: 2 },
          columnGap: 2,
          '& > *': { breakInside: 'avoid', display: 'block' },
        }}
      >
        {grouped.map(cg => renderCatGroup(cg))}
      </Box>

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

      {dispatchError   && <Alert severity="error" sx={{ mb: 1, whiteSpace: 'pre-line' }}>{dispatchError}</Alert>}
      {approveError    && <Alert severity="error" sx={{ mb: 1, whiteSpace: 'pre-line' }}>{approveError}</Alert>}
      {rejectError     && <Alert severity="error" sx={{ mb: 1, whiteSpace: 'pre-line' }}>{rejectError}</Alert>}
      {revokeError     && <Alert severity="error" sx={{ mb: 1, whiteSpace: 'pre-line' }}>{revokeError}</Alert>}
      {saveDraftError  && <Alert severity="error" sx={{ mb: 1, whiteSpace: 'pre-line' }}>{saveDraftError}</Alert>}
      {clearDraftError && <Alert severity="error" sx={{ mb: 1, whiteSpace: 'pre-line' }}>{clearDraftError}</Alert>}

      {acceptError && <Alert severity="error" sx={{ mb: 1, whiteSpace: 'pre-line' }}>{acceptError}</Alert>}

      {/* Sticky bottom bar — shown when the request is awaiting either a
          Dispatch (Order) or an Accept (Return). Same qty-entry mechanic; the
          finalise button + text labels switch by request type. */}
      {canEditQty && (
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
              <Box sx={{ fontSize: 18, fontWeight: 700, color: '#1F1F1F' }}>
                {isReturn ? 'Return total' : 'Dispatch total'} {formatINR(stats.dispatchTotal)}
              </Box>
              {/* Quiet draft state hint — Order-only (Returns have no draft). */}
              {canDispatch && (draftSavedAt || hasInitialDraft) && (
                <Box sx={{ fontSize: 11, color: '#1F1F1F99', mt: 0.25 }}>
                  Draft {draftSavedAt
                    ? `saved at ${formatIstTime(draftSavedAt)}`
                    : 'restored from your last visit'}
                </Box>
              )}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {/* Draft Save / Discard — Order-only. Returns are one-shot;
                the godown either Accepts the return or Rejects it, no WIP. */}
            {canDispatch && hasInitialDraft && (
              <Button
                variant="outlined"
                onClick={handleDiscardDraft}
                disabled={clearDraftMutation.isPending}
                sx={{
                  textTransform: 'none', fontWeight: 600, whiteSpace: 'nowrap',
                  borderColor: '#C62828', color: '#C62828',
                  '&:hover': { borderColor: '#C62828', bgcolor: 'rgba(198,40,40,0.05)' },
                }}
              >
                {clearDraftMutation.isPending ? 'Discarding…' : 'Discard Draft'}
              </Button>
            )}
            {canDispatch && (
              <Button
                variant="outlined"
                onClick={handleSaveDraft}
                disabled={saveDraftMutation.isPending || dispatchQtys.size === 0 || !isDraftDirty}
                title={
                  dispatchQtys.size === 0
                    ? 'Enter at least one quantity before saving'
                    : !isDraftDirty
                      ? 'Already saved — make a change to save again'
                      : undefined
                }
                sx={{
                  textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap',
                  borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFFFFF',
                  '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
                }}
              >
                {saveDraftMutation.isPending
                  ? 'Saving…'
                  : !isDraftDirty && dispatchQtys.size > 0
                    ? 'Saved'
                    : 'Save as Draft'}
              </Button>
            )}
            {/* Finalise — Dispatch for Orders, Accept for Returns. Same
                "every line filled" gate (0 is valid = out of stock / refused
                that item). */}
            <Button
              variant="contained"
              startIcon={<PackageCheck className="w-4 h-4" />}
              onClick={() => setConfirmOpen(true)}
              disabled={
                (canAccept ? acceptReturnMutation.isPending : dispatchMutation.isPending)
                || !allLinesFilled
              }
              title={!allLinesFilled ? 'Enter a quantity for every product first (0 = out of stock)' : undefined}
              sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}
            >
              {canAccept
                ? (acceptReturnMutation.isPending ? 'Accepting…' : 'Accept Return')
                : (dispatchMutation.isPending ? 'Dispatching…' : 'Mark as Dispatched')}
            </Button>
          </Box>
        </Paper>
      )}

      {/* One confirm dialog drives both finalisations — text + handler flip
          on isReturn / canAccept. The same `confirmOpen` state opens it from
          either the Dispatch or Accept Return button. */}
      <ConfirmDialog
        open={confirmOpen}
        title={canAccept ? 'Accept this return?' : 'Confirm dispatch?'}
        message={canAccept
          ? `Mark ${request.code} as Accepted with the quantities entered (total ${formatINR(stats.dispatchTotal)}). This closes the return on the godown side.`
          : `Mark ${request.code} as Dispatched with the quantities entered (total ${formatINR(stats.dispatchTotal)}). The shop will then be able to confirm receipt.`}
        confirmLabel={canAccept ? 'Yes, Accept' : 'Yes, Dispatch'}
        cancelLabel="Not yet"
        onConfirm={canAccept ? handleAccept : handleDispatch}
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

      {/* Unsaved-changes guard modal. "Save as Draft" option is only offered
          while the request is in a dispatchable state (Pending/Approved) —
          for any other status there's no draft concept to save into. */}
      <UnsavedChangesDialog
        open={guard.state === 'blocked'}
        onSaveDraft={canDispatch
          ? async () => {
              // Same payload-shape rule as the auto-save effect — only the
              // items the user has typed for. No requestedQty fallback for
              // untouched items.
              const itemsPayload = items
                .filter(it => dispatchQtys.has(it.id))
                .map(it => ({ id: it.id, dispatchedQty: dispatchQtys.get(it.id)! }))
              if (itemsPayload.length === 0) {
                throw new Error('Enter at least one quantity before saving.')
              }
              await saveDraftMutation.mutateAsync({ id: request.id, req: { items: itemsPayload } })
              setDraftSavedAt(new Date())
              setIsDraftDirty(false)
              guard.proceed?.()
            }
          : undefined}
        onDiscard={() => guard.proceed?.()}
        onCancel={() => guard.reset?.()}
      />
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
  const tooltip = `${formatIstDateTime(at)}${done && by ? ` · by ${by}` : ''}`
  return (
    <Chip
      title={tooltip}
      icon={done ? <Check className="w-3.5 h-3.5" /> : undefined}
      label={
        <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
          <Box sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, opacity: done ? 1 : 0.6 }}>{label}</Box>
          <Box sx={{ fontSize: 11, opacity: done ? 0.8 : 0.4 }}>{done ? formatIstDateTime(at, '') : '—'}</Box>
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
