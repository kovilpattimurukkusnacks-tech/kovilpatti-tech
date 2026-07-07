import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, PackageCheck, Check, Printer, X, Undo2, Plus, Trash2, ChevronUp, ChevronDown, Star } from 'lucide-react'
import {
  Alert, Autocomplete, Badge, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import { DispatchedCell } from '../../components/DispatchedCell'
import { InvBadge } from '../../components/InvBadge'
import { RequestSummary } from '../../components/RequestSummary'
import { formatINR } from '../../utils/format'
import { formatIstDateTime, formatIstTime } from '../../utils/formatDate'
import {
  useStockRequest, useDispatchStockRequest,
  useApproveStockRequest, useRejectStockRequest, useRevokeStockRequest,
  useSaveDispatchDraft, useClearDispatchDraft,
  useAcceptReturn,
  useInventoryAddItems, useInventoryRemoveItem,
} from '../../hooks/useStockRequests'
import { useProducts } from '../../hooks/useProducts'
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
import { UnsavedChangesDialog } from '../../components/UnsavedChangesDialog'
import { ValidationError } from '../../api/errors'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import { buildRootLookup, sortRootCategoryNames } from '../../utils/rootCategoryPriority'
import { useCategories } from '../../hooks/useCategories'

// Consolidated into utils/statusChipStyle.ts so a color tweak lands in one place.
import { STATUS_COLOR, STATUS_CHIP_SX } from '../../utils/statusChipStyle'

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
  const addItemsMutation     = useInventoryAddItems()
  const removeItemMutation   = useInventoryRemoveItem()
  // Accept Return — Pending Return → Accepted (terminal). Same per-item qty
  // payload as Dispatch but writes acceptedQty (BE maps to dispatched_qty
  // column; partial accept allowed if godown counts less).
  const acceptReturnMutation = useAcceptReturn()

  // Per-item "to dispatch" quantities. Starts at requested_qty; inventory can
  // ship less if they're out of stock (clamped to ≤ requested_qty).
  const [dispatchQtys, setDispatchQtys] = useState<Map<string, number>>(new Map())
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null)
  // Confirm-dialog gate for Discard Draft (29-Jun-2026 client follow-up).
  // Same risk as the Shop side — dispatch row sits the discard button
  // close to Save / Mark as Dispatched, and an accidental click wipes
  // whatever dispatch qtys the godown has been typing in.
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)
  // Add Products dialog (01-Jul-2026). Opens when inventory / admin wants
  // to append lines to a Pending / Approved order. `addRows` holds the
  // in-progress pick list; committed rows are POSTed together on Save.
  const [addOpen, setAddOpen] = useState(false)
  const [addRows, setAddRows] = useState<{ productId: string; requestedQty: number }[]>([])
  const [addPickerProductId, setAddPickerProductId] = useState<string>('')
  const [addPickerQty, setAddPickerQty] = useState<string>('')
  // Product catalog for the picker — fetched once when the dialog opens.
  // Kept simple: no search debounce; the Autocomplete does client-side
  // filtering off the pre-fetched list, which is fine at this catalog size.
  const productsQuery = useProducts({ pageSize: 500 })
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
  //   3. (none)              — empty input; godown types each line manually
  //
  // 07-Jul-2026 (client req): removed the Approved-state auto-fill of every
  // line to requestedQty. The godown wants explicit intent on every qty —
  // pre-filling encouraged accidental "Mark as Dispatched" clicks where
  // the actual on-hand didn't match the shop's ask. Approved rows now
  // land blank, same as Pending, until the godown types values in.
  //
  // isDraftDirty: false on seed (nothing to save yet). Flipped to true
  // when the user types.
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
    for (const item of request.items ?? []) {
      if (item.draftDispatchedQty != null) {
        map.set(item.id, item.draftDispatchedQty)
      } else if (item.dispatchedQty != null) {
        map.set(item.id, item.dispatchedQty)
      }
      // No default seed for Approved — inputs stay empty until the godown
      // types a qty, matching the Pending flow.
    }
    setDispatchQtys(map)
    setIsDraftDirty(false)
    // 02-Jul-2026: dependencies MUST be [id, status] only — NOT the whole
    // request object. Auto-save mutations refetch the request and hand us a
    // new object reference; re-running this seed on that refresh was
    // overwriting the user's in-progress erase (they wiped a qty, auto-save
    // fired 1.5s later, response came back with the old persisted draft
    // still in it, and this effect re-filled the wiped cell). Same request
    // id + same status → user's local state must NOT be reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id, request?.status])

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
    let dispatchTotal  = 0
    let requestedTotal = 0
    let shortLines     = 0
    for (const it of items) {
      // dispatchTotal sums ONLY typed-in qtys (not a `?? requestedQty`
      // fallback) so Pending-state (nothing typed yet) shows ₹0, not the
      // requested total. On Approved the seed populates every entry so
      // this still resolves to full requested amount by default.
      const typed = dispatchQtys.get(it.id)
      if (typed != null) {
        dispatchTotal += typed * it.unitPrice
        if (typed < it.requestedQty) shortLines++
      }
      requestedTotal += it.requestedQty * it.unitPrice
    }
    return { dispatchTotal, requestedTotal, shortLines }
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

  // Two-level grouping: outer = root category in hard-coded priority order;
  // inner = leaf-cat cards (existing layout). Mirrors Shop / Admin detail
  // pages so dispatcher sees the same top-level hierarchy (30-Jun-2026).
  const categoriesQuery = useCategories()
  const rootGroups = useMemo(() => {
    const lookup = buildRootLookup(categoriesQuery.data)
    const byRoot = new Map<string, typeof grouped>()
    for (const cg of grouped) {
      const root = lookup(cg.category)
      const arr = byRoot.get(root)
      if (arr) arr.push(cg)
      else byRoot.set(root, [cg])
    }
    return sortRootCategoryNames(Array.from(byRoot.keys()))
      .map(root => {
        const children = byRoot.get(root)!
        const productCount = children.reduce(
          (sum, cg) => sum + cg.weightGroups.reduce((s, wg) => s + wg.items.length, 0),
          0,
        )
        return { root, children, productCount }
      })
  }, [grouped, categoriesQuery.data])

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
  //
  // 07-Jul-2026 bug fix: don't short-circuit when the map is empty. Prior
  // check `dispatchQtys.size === 0` prevented the timer from setting up
  // when the user erased every line — leaving isDraftDirty=true forever
  // and the persisted server draft untouched. Now the timer runs and its
  // own hasAnyValue / hasDraftToClear guard decides whether to POST.
  useEffect(() => {
    if (!canDispatch || !isDraftDirty) return
    // request can be undefined on the very first render before the query
    // resolves; canDispatch evaluates to false in that case so we're
    // already returning above, but the optional chain below is defensive.
    const requestId = request?.id
    if (!requestId) return

    const timer = setTimeout(() => {
      const startCount = changeCountRef.current
      // Include every item in the request. Items the user has typed for →
      // send their current value. Items the user erased (or never touched
      // but had a persisted draft) → send null so the SP clears the DB
      // draft. Without this, the persisted draft stays in the DB and
      // silently re-fills the wiped cell on the next refetch.
      const itemsPayload = items.map(it => ({
        id: it.id,
        dispatchedQty: dispatchQtys.has(it.id) ? dispatchQtys.get(it.id)! : null,
      }))
      // If NOTHING is set AND nothing to clear → skip the network round-trip
      // AND clear the dirty flag. Local state matches the server (both empty),
      // so leaving isDraftDirty=true would falsely trigger the unsaved-changes
      // guard on navigate. 07-Jul-2026.
      const hasAnyValue    = itemsPayload.some(p => p.dispatchedQty != null)
      const hasDraftToClear = items.some(it => it.draftDispatchedQty != null && !dispatchQtys.has(it.id))
      if (!hasAnyValue && !hasDraftToClear) {
        if (changeCountRef.current === startCount) setIsDraftDirty(false)
        return
      }
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
      // 30-Jun-2026: redirect back to Needs Action after a successful
      // dispatch so the dispatcher lands on the next request to work on
      // instead of the just-finalised one they can't edit anymore.
      // /inventory/requests defaults to preset='pending' (= Needs Action).
      navigate('/inventory/requests')
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
    // Same "full manifest" strategy as the auto-save effect: send every
    // item; erased ones go with dispatchedQty=null so the SP clears their
    // persisted draft. See the auto-save comment for the rationale.
    const itemsPayload = items.map(it => ({
      id: it.id,
      dispatchedQty: dispatchQtys.has(it.id) ? dispatchQtys.get(it.id)! : null,
    }))
    const hasAnyValue     = itemsPayload.some(p => p.dispatchedQty != null)
    const hasDraftToClear = items.some(it => it.draftDispatchedQty != null && !dispatchQtys.has(it.id))
    if (!hasAnyValue && !hasDraftToClear) return
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
   * requestedQty for Approved). Gated behind a ConfirmDialog — see the
   * `discardConfirmOpen` state and the click handler on the Discard button.
   */
  const handleDiscardDraft = async () => {
    try {
      await clearDraftMutation.mutateAsync(request.id)
      setDraftSavedAt(null)
      setDiscardConfirmOpen(false)
      // The useEffect seeded the new state from the refreshed cache — leave
      // isDraftDirty to it (seed sets it based on what's there now).
    } catch {
      // surfaced via the error alert below — leave dialog open for retry
    }
  }

  const handleApprove = async () => {
    try {
      await approveMutation.mutateAsync(request.id)
      // Post-approve UX (07-Jul-2026, client req): the request is no longer
      // in the godown's Needs-Action queue — bounce back to the list AND
      // switch to In-Progress so the user sees where it moved to. `?preset=`
      // is read by InventoryRequests.tsx on mount to select the tab.
      setApproveConfirm(false)
      navigate('/inventory/requests?preset=approved')
    } catch {
      // Error surface via approveError alert. Keep the confirm open so the
      // user can retry.
      setApproveConfirm(false)
    }
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
  // Inventory can append items post-approval (01-Jul-2026 client req).
  // Order-only, and only while the request is still editable (Pending
  // or Approved; once dispatched, the qty is frozen).
  const canAddItems = !isReturn && (request.status === 'Pending' || request.status === 'Approved')

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
      sx={{ mb: 2, borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFF8DC', overflow: 'hidden' }}
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
          {/* Column headers row (30-Jun-2026 client req). Dispatched column
              is center-aligned to match the qty input placement below. */}
          <TableHead>
            <TableRow sx={{ bgcolor: '#FFFBE6' }}>
              <TableCell sx={{ py: 0.75, pl: 3, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', borderBottom: '1px solid rgba(31,31,31,0.15)' }}>Product</TableCell>
              <TableCell align="right"  sx={{ py: 0.75, width: 90,  fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', borderBottom: '1px solid rgba(31,31,31,0.15)' }}>Req Qty</TableCell>
              <TableCell align="center" sx={{ py: 0.75, width: 130, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', borderBottom: '1px solid rgba(31,31,31,0.15)' }}>Disp Qty</TableCell>
              <TableCell align="right"  sx={{ py: 0.75, width: 100, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', borderBottom: '1px solid rgba(31,31,31,0.15)' }}>MRP</TableCell>
              <TableCell align="right"  sx={{ py: 0.75, width: 110, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', borderBottom: '1px solid rgba(31,31,31,0.15)' }}>Net Amt</TableCell>
            </TableRow>
          </TableHead>
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
                  // Short / over flags drive both the qty input chrome and
                  // the row-level tint + line-total colour. The `canEditQty`
                  // guard limits the in-edit chrome (red/amber background +
                  // border on the TextField) — but the row tint + total
                  // colour apply whether or not the user can still edit, so
                  // the variance reads the same once the request is locked.
                  const isShort = canEditQty && currentDispatch < item.requestedQty
                  const isOver  = canEditQty && currentDispatch > item.requestedQty
                  const dispatched = item.dispatchedQty
                  const persistedShort = dispatched != null && dispatched < item.requestedQty
                  const persistedOver  = dispatched != null && dispatched > item.requestedQty
                  const rowShort = isShort || persistedShort
                  const rowOver  = isOver  || persistedOver
                  const rowBg = rowShort ? 'rgba(198,40,40,0.06)'
                              : rowOver  ? 'rgba(230,81,0,0.07)'
                              : 'transparent'
                  const totalColor = rowShort ? '#C62828' : rowOver ? '#E65100' : '#1F1F1F'
                  return (
                    <TableRow key={item.id} hover sx={{ bgcolor: rowBg, '& > td': { verticalAlign: 'top' } }}>
                      <TableCell sx={{ pl: 3, py: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontWeight: 600, fontSize: 14 }}>
                          <span>{item.productName}</span>
                          {item.addedBy === 'Inventory' && <InvBadge />}
                          {/* Partial-weight return chip — shop claimed a
                              fraction of a pack (B2 damage claim). */}
                          {item.returnWeightG != null && (
                            <Chip
                              label={`Partial · ${item.returnWeightG}g`}
                              size="small"
                              sx={{
                                ml: 0.5,
                                bgcolor: '#FFE0B2', color: '#7C4A00',
                                border: '1px solid #E8A758',
                                height: 20, fontSize: 10, fontWeight: 700,
                              }}
                            />
                          )}
                          {/* Trash icon only for inv-added items while
                              request is still editable — removes just
                              this line via the inv-remove endpoint. */}
                          {item.addedBy === 'Inventory' && canAddItems && (
                            <IconButton
                              size="small"
                              onClick={() => removeItemMutation.mutate({ id: request.id, itemId: item.id })}
                              disabled={removeItemMutation.isPending}
                              aria-label="Remove this inv-added line"
                              title="Remove this inv-added line"
                              sx={{ p: 0.25, ml: 0.5, color: '#C62828' }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </IconButton>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ py: 1, width: 90 }}>{item.requestedQty}</TableCell>
                      <TableCell align="center" sx={{ py: 0.5, width: 130 }}>
                        {canEditQty ? (
                          <TextField
                            /* type="text" + inputMode="numeric" — no native
                               spinner (that's the white-bg one we couldn't
                               tame). Mobile keyboards still open numeric.
                               Custom +/- buttons below sit in an
                               InputAdornment so they inherit the wrapper's
                               state colour cleanly. */
                            type="text"
                            size="small"
                            value={dispatchQtys.get(item.id) ?? ''}
                            onChange={e => {
                              // Digits only — reject anything else at the
                              // input layer since we no longer get type=number
                              // filtering. Empty string = "cleared".
                              const v = e.target.value
                              if (v === '' || /^\d+$/.test(v)) {
                                setItemQty(item.id, v, item.requestedQty)
                              }
                            }}
                            onKeyDown={e => {
                              if (['e', 'E', '+', '-', '.', ','].includes(e.key)) e.preventDefault()
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.disp-qty-input'))
                                const idx = inputs.indexOf(e.target as HTMLInputElement)
                                inputs[idx + 1]?.focus()
                              }
                            }}
                            onWheel={e => (e.target as HTMLInputElement).blur()}
                            onFocus={e => {
                              const el = e.target as HTMLInputElement
                              el.scrollIntoView({ block: 'center', behavior: 'smooth' })
                              el.select()
                            }}
                            slotProps={{
                              htmlInput: { inputMode: 'numeric', className: 'disp-qty-input', style: { textAlign: 'center', padding: '4px 8px' } },
                              input: {
                                endAdornment: (
                                  // Compact +/- stack; only visible on hover
                                  // of the whole cell (see :hover rule in
                                  // parent sx). Buttons inherit the wrapper's
                                  // cream/red/amber bg via transparent bg.
                                  <InputAdornment position="end" sx={{ ml: 0, mr: -0.5 }}>
                                    <Box
                                      className="qty-stepper"
                                      sx={{ display: 'flex', flexDirection: 'column', opacity: 0, transition: 'opacity 120ms ease' }}
                                    >
                                      <IconButton
                                        size="small"
                                        tabIndex={-1}
                                        onClick={() => {
                                          const cur = dispatchQtys.get(item.id) ?? 0
                                          setItemQty(item.id, String(cur + 1), item.requestedQty)
                                        }}
                                        sx={{ p: 0, height: 12, width: 16, borderRadius: 0, color: '#1F1F1F' }}
                                      >
                                        <ChevronUp className="w-3 h-3" />
                                      </IconButton>
                                      <IconButton
                                        size="small"
                                        tabIndex={-1}
                                        onClick={() => {
                                          const cur = dispatchQtys.get(item.id) ?? 0
                                          if (cur > 0) setItemQty(item.id, String(cur - 1), item.requestedQty)
                                        }}
                                        sx={{ p: 0, height: 12, width: 16, borderRadius: 0, color: '#1F1F1F' }}
                                      >
                                        <ChevronDown className="w-3 h-3" />
                                      </IconButton>
                                    </Box>
                                  </InputAdornment>
                                ),
                              },
                            }}
                            sx={{
                              width: 86,
                              '& .MuiOutlinedInput-root': {
                                bgcolor: isShort ? '#FFEBEE' : isOver ? '#FFE0B2' : '#FFF8DC',
                                '& fieldset': { borderColor: isShort ? '#C62828' : isOver ? '#E65100' : '#1F1F1F' },
                              },
                              // Reveal the +/- stack when the input is hovered
                              // or focused. Kept hidden otherwise so the
                              // resting cell is clean state-colour only.
                              '&:hover .qty-stepper, & .Mui-focused ~ .qty-stepper, & .MuiOutlinedInput-root.Mui-focused .qty-stepper': {
                                opacity: 1,
                              },
                            }}
                          />
                        ) : (
                          <DispatchedCell qty={item.dispatchedQty} requested={item.requestedQty} received={item.receivedQty} />
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ py: 1, width: 100 }}>{formatINR(item.unitPrice)}</TableCell>
                      <TableCell align="right" sx={{ py: 1, width: 110, fontWeight: 600, color: totalColor, whiteSpace: 'nowrap' }}>{formatINR(lineTotal)}</TableCell>
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
    // pb leaves room for one of two fixed bottom bars + breathing space
    // above so action buttons don't sit flush against the footer:
    // dispatch bar (pre-finalise, canEditQty) OR summary bar (post-finalise,
    // 19-Jun-2026, client #14). Same clearance for either.
    <Box sx={{ pb: 16 }}>
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
                  borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFF8E1',
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
                borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFF8E1',
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
          sx={{ fontWeight: 700, ...STATUS_CHIP_SX[request.status] }}
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
        {/* Dispatch draft indicator — mirrors the list-row chip on
            /inventory/requests + /admin/requests. Rendered whenever ANY
            item on this request has a saved draft_dispatched_qty. */}
        {items.some(it => it.draftDispatchedQty != null) && (
          <Chip
            label="Draft"
            size="small"
            variant="outlined"
            sx={{
              borderColor: '#C28A00',
              color: '#7C4A00',
              bgcolor: '#FFF8E1',
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          />
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

      {/* Special Request strip (06-Jul-2026, client req). Godown side is
          READ-ONLY: only the shop can toggle / rename (SP-side gate on
          fn_request_set_special enforces this — no pencil affordance
          here). Amber to match the sticky banner + list chip so the
          godown user sees the same signal all the way through: at the
          list, on the banner, on this detail, on the picklist print. */}
      {request.isSpecial && (
        <Paper
          elevation={0}
          sx={{
            p: 1.5, mb: 2, borderRadius: 2,
            bgcolor: '#FFB74D',
            border: '2px solid #E65100',
            boxShadow: '0 1px 3px rgba(230, 81, 0, 0.25)',
            display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap',
          }}
        >
          <Star className="w-5 h-5" style={{ color: '#3E2500' }} />
          <Box sx={{ fontWeight: 800, color: '#3E2500', fontSize: 13, letterSpacing: 0.3 }}>
            Special Request
          </Box>
          <Box sx={{
            px: 1, py: 0.25, borderRadius: 1,
            bgcolor: '#FFF8DC', border: '1px solid #3E2500',
            fontWeight: 700, color: '#3E2500', fontSize: 13,
            maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {request.specialLabel?.trim() || 'Unnamed special'}
          </Box>
          <Box sx={{
            fontSize: 11.5, fontWeight: 700, color: '#3E2500',
            textTransform: 'uppercase', letterSpacing: 0.5,
            ml: 'auto',
          }}>
            Procure from vendor · do not pack from stock
          </Box>
        </Paper>
      )}

      {/* Add Products — appears only when the request is still editable
          (Pending / Approved, Order-only). Special-request declaration is
          shop-side now (06-Jul-2026), so godown no longer carves. */}
      {canAddItems && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 1.5 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Plus className="w-4 h-4" />}
            onClick={() => { setAddRows([]); setAddPickerProductId(''); setAddPickerQty(''); setAddOpen(true) }}
            sx={{
              textTransform: 'none', fontWeight: 700,
              bgcolor: '#FFF8E1', color: '#1F1F1F',
              borderColor: '#C28A00', borderWidth: '1.5px',
              '&:hover': { bgcolor: '#FCD835', borderColor: '#A07000', borderWidth: '1.5px' },
            }}
          >
            Add Products
          </Button>
        </Box>
      )}

      {/* Shop-reported receipt discrepancy (02-Jul-2026). Godown side
          view of the same banner rendered on shop + admin detail pages.
          Only renders on Received requests where the shop's count didn't
          match dispatched. */}
      {(() => {
        let shortLines = 0, overLines = 0, shortUnits = 0, overUnits = 0
        for (const it of items) {
          if (it.receivedQty == null) continue
          const disp = it.dispatchedQty ?? 0
          if (it.receivedQty < disp) { shortLines++; shortUnits += (disp - it.receivedQty) }
          if (it.receivedQty > disp) { overLines++;  overUnits  += (it.receivedQty - disp) }
        }
        if (shortLines === 0 && overLines === 0) return null
        return (
          <Alert severity={shortLines > 0 ? 'error' : 'warning'} sx={{ mb: 2 }}>
            <strong>Shop reported a receipt discrepancy.</strong>{' '}
            {shortLines > 0 && (
              <>{shortLines} line{shortLines === 1 ? '' : 's'} short · {shortUnits} unit{shortUnits === 1 ? '' : 's'} missing</>
            )}
            {shortLines > 0 && overLines > 0 && ' · '}
            {overLines > 0 && (
              <>{overLines} line{overLines === 1 ? '' : 's'} over · {overUnits} extra unit{overUnits === 1 ? '' : 's'}</>
            )}
          </Alert>
        )
      })()}

      {/* Items — cream banner strip per root (mirrors Shop / Admin).
          Plain underline style is reserved for the print picklist. */}
      <Box sx={{ mb: 3 }}>
        {rootGroups.map(rg => (
          <Box key={rg.root} sx={{ mb: 2.5 }}>
            <Box
              sx={{
                background: 'linear-gradient(90deg, #C28A00 0%, #E6B800 35%, #FFD700 65%, #FFF1A6 100%)',
                border: '2px solid #1F1F1F',
                borderRadius: 1,
                boxShadow: '2px 2px 0 0 rgba(31,31,31,0.15)',
                px: 2,
                py: 1.1,
                mb: 1.5,
                textAlign: 'center',
                fontSize: { xs: 13.5, sm: 14.5 },
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: 1.2,
                color: '#1F1F1F',
              }}
            >
              {rg.root}
              <Box
                component="span"
                sx={{ ml: 1, fontSize: 11.5, color: 'rgba(31,31,31,0.65)', fontWeight: 600, letterSpacing: 0.4 }}
              >
                · {rg.productCount} {rg.productCount === 1 ? 'product' : 'products'}
              </Box>
            </Box>
            <Box
              sx={{
                columnCount: { xs: 1, md: 2 },
                columnGap: 2,
                '& > *': { breakInside: 'avoid', display: 'block' },
              }}
            >
              {rg.children.map(cg => renderCatGroup(cg))}
            </Box>
          </Box>
        ))}
      </Box>

      {/* Receipt-change log (02-Jul-2026). Same table godown sees on the
          shop side — surfaces the shop's per-line count vs what godown
          dispatched. Only renders when at least one line has
          receivedQty set. */}
      {(() => {
        const changed = items.filter(it => it.receivedQty != null)
        if (changed.length === 0) return null
        return (
          <Paper
            elevation={0}
            sx={{ mb: 2, borderRadius: 2, border: '1px solid rgba(31,31,31,0.2)', overflow: 'hidden' }}
          >
            <Box sx={{
              px: 2, py: 1, bgcolor: '#FFF8DC',
              borderBottom: '1px solid rgba(31,31,31,0.2)',
              fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: '#1F1F1F',
            }}>
              Shop-reported receipt changes · {changed.length} {changed.length === 1 ? 'product' : 'products'}
            </Box>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#FFFBE6' }}>
                  <TableCell sx={{ py: 0.75, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99' }}>Product</TableCell>
                  <TableCell align="right" sx={{ py: 0.75, width: 100, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99' }}>Dispatched</TableCell>
                  <TableCell align="right" sx={{ py: 0.75, width: 100, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99' }}>Received</TableCell>
                  <TableCell align="right" sx={{ py: 0.75, width: 90,  fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99' }}>Change</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {changed.map(it => {
                  const disp  = it.dispatchedQty ?? 0
                  const rec   = it.receivedQty!
                  const delta = rec - disp
                  const short = delta < 0
                  const over  = delta > 0
                  return (
                    <TableRow key={it.id}>
                      <TableCell sx={{ py: 0.9, fontSize: 13, fontWeight: 600 }}>{it.productName}</TableCell>
                      <TableCell align="right" sx={{ py: 0.9, fontSize: 13 }}>{disp}</TableCell>
                      <TableCell align="right" sx={{ py: 0.9, fontSize: 13, fontWeight: 700, color: short ? '#C62828' : over ? '#E65100' : '#1F1F1F' }}>{rec}</TableCell>
                      <TableCell align="right" sx={{ py: 0.9, fontSize: 13, fontWeight: 700, color: short ? '#C62828' : over ? '#E65100' : '#1F1F1F' }}>
                        {short ? delta : over ? `+${delta}` : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Paper>
        )
      })()}

      {/* Fixed summary bar — same shape as the New Stock Request cart bar.
          19-Jun-2026 (client #14). Hidden when canEditQty is true because
          the pre-dispatch dispatch bar below already serves the same
          screen real estate (with live draft totals + Finalise button) —
          two stacked fixed bars would overlap. */}
      {!canEditQty && (
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
          }}
        >
          <RequestSummary request={request} variant="footer" />
        </Paper>
      )}

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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, minWidth: 0, flexWrap: 'wrap' }}>
            <Badge badgeContent={stats.shortLines} color="error" max={99} invisible={stats.shortLines === 0}>
              <PackageCheck className="w-5 h-5 text-[#1F1F1F]" />
            </Badge>
            {/* Requested (shop's original ask) — static, doesn't change as
                the godown types. Left side per client req (02-Jul-2026).
                Muted so the primary Dispatch total remains the eye-catch. */}
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ fontSize: 10.5, fontWeight: 700, color: '#1F1F1F99', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Requested
              </Box>
              <Box sx={{ fontSize: 16, fontWeight: 700, color: '#1F1F1F99' }}>
                {formatINR(stats.requestedTotal)}
              </Box>
            </Box>
            {/* Vertical hairline separator so the two totals read as a
                paired unit (₹requested → ₹dispatched) rather than
                separate chips. */}
            <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: 'rgba(31,31,31,0.15)' }} />
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ fontSize: 10.5, fontWeight: 700, color: '#1F1F1F', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                {isReturn ? 'Return' : 'Dispatch'}
                {/* Show short/over as soon as the godown starts dispatching
                    (dispatchTotal > 0). Resting state (nothing typed →
                    dispatchTotal = 0) suppresses the label so it doesn't
                    read as "everything's short" on a fresh screen. */}
                {stats.dispatchTotal > 0 && stats.dispatchTotal < stats.requestedTotal && (
                  <Box component="span" sx={{ ml: 0.75, color: '#C62828', fontSize: 10 }}>
                    · short {formatINR(stats.requestedTotal - stats.dispatchTotal)}
                  </Box>
                )}
                {stats.dispatchTotal > stats.requestedTotal && (
                  <Box component="span" sx={{ ml: 0.75, color: '#E65100', fontSize: 10 }}>
                    · over {formatINR(stats.dispatchTotal - stats.requestedTotal)}
                  </Box>
                )}
              </Box>
              <Box sx={{ fontSize: 18, fontWeight: 700, color: '#1F1F1F' }}>
                {formatINR(stats.dispatchTotal)}
              </Box>
              <Box sx={{ fontSize: 12, color: '#1F1F1F99' }}>
                {!allLinesFilled
                  ? `Enter qty for ${items.length - dispatchQtys.size} more line${items.length - dispatchQtys.size === 1 ? '' : 's'}`
                  : stats.shortLines > 0
                    ? `${stats.shortLines} line${stats.shortLines === 1 ? '' : 's'} short of requested`
                    : 'All lines at requested qty'}
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
          {/* Discard Draft — lifted OUT of the action row on 29-Jun-2026
              (third pass). With justifyContent:space-between on the outer
              Paper and 3 flex children (cart info / Discard / Save+Dispatch),
              Discard sits in the middle of the bar — well separated from
              the primary Save & Mark-as-Dispatched cluster so a stray
              click on the right-side actions can't catch it. Order-only;
              Returns have no draft. */}
          {canDispatch && hasInitialDraft && (
            <Button
              variant="outlined"
              onClick={() => setDiscardConfirmOpen(true)}
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
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
                  borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFF8E1',
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
          <Button onClick={() => setRejectOpen(false)} variant="outlined" disabled={rejectMutation.isPending} sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#1F1F1F', color: '#1F1F1F', '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' } }}>
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
              // Full-manifest payload (matches auto-save + handleSaveDraft)
              // so erased items clear their persisted draft on the DB side.
              const itemsPayload = items.map(it => ({
                id: it.id,
                dispatchedQty: dispatchQtys.has(it.id) ? dispatchQtys.get(it.id)! : null,
              }))
              const hasAnyValue = itemsPayload.some(p => p.dispatchedQty != null)
              if (!hasAnyValue) {
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

      {/* Discard Draft confirm — gated so a stray click on the action row
          doesn't wipe minutes of typed-in dispatch qtys. */}
      <ConfirmDialog
        open={discardConfirmOpen}
        title="Discard this dispatch draft?"
        message={`The saved per-line quantities for ${request.code} will be cleared and the form re-seeds to defaults. This can't be undone.`}
        confirmLabel="Yes, discard"
        cancelLabel="Keep editing"
        onConfirm={handleDiscardDraft}
        onCancel={() => setDiscardConfirmOpen(false)}
      />

      {/* Add Products dialog (01-Jul-2026). Godown picks products +
          qtys → each row is queued in `addRows` in the dialog → Save
          POSTs the batch through fn_request_inventory_add_items, which
          rejects duplicates. Products already in the request are hidden
          from the picker to short-circuit the duplicate case. */}
      <Dialog
        open={addOpen}
        onClose={(_e, reason) => {
          if (reason === 'backdropClick' || addItemsMutation.isPending) return
          setAddOpen(false)
        }}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3 } } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 700 }}>
          Add products to {request.code}
          <IconButton size="small" onClick={() => setAddOpen(false)} disabled={addItemsMutation.isPending}>
            <X className="w-4 h-4" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ fontSize: 12, color: '#1F1F1F99', mb: 1.5 }}>
            These lines will be tagged <strong style={{ color: '#0277BD' }}>(inv)</strong> so the shop and admin see they came in post-approval.
          </Box>

          {/* Picker row — Autocomplete + qty + Add button.
              Products already in the request OR already staged in
              addRows are filtered out so the dispatcher can't create
              a duplicate. */}
          {(() => {
            const inRequestIds = new Set((request.items ?? []).map(i => i.productId))
            const stagedIds    = new Set(addRows.map(r => r.productId))
            const eligible = (productsQuery.data?.items ?? [])
              .filter(p => !inRequestIds.has(p.id) && !stagedIds.has(p.id))
            const picked = eligible.find(p => p.id === addPickerProductId) ?? null
            return (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: 2 }}>
                <Autocomplete
                  size="small"
                  sx={{ flex: 1 }}
                  options={eligible}
                  value={picked}
                  onChange={(_e, val) => setAddPickerProductId(val?.id ?? '')}
                  getOptionLabel={(p) => `${p.code} — ${p.name}`}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  loading={productsQuery.isLoading}
                  renderInput={(params) => (
                    <TextField {...params} placeholder="Search product…" />
                  )}
                />
                <TextField
                  size="small"
                  type="number"
                  placeholder="Qty"
                  value={addPickerQty}
                  onChange={e => setAddPickerQty(e.target.value)}
                  onWheel={e => (e.target as HTMLInputElement).blur()}
                  onFocus={e => (e.target as HTMLInputElement).select()}
                  slotProps={{ htmlInput: { min: 1, inputMode: 'numeric' } }}
                  sx={{ width: 90 }}
                />
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => {
                    const qty = parseInt(addPickerQty, 10)
                    if (!addPickerProductId || Number.isNaN(qty) || qty <= 0) return
                    setAddRows(prev => [...prev, { productId: addPickerProductId, requestedQty: qty }])
                    setAddPickerProductId('')
                    setAddPickerQty('')
                  }}
                  disabled={!addPickerProductId || !addPickerQty || parseInt(addPickerQty, 10) <= 0}
                  sx={{
                    textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap',
                    borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFF8E1',
                    '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
                  }}
                >
                  Add
                </Button>
              </Box>
            )
          })()}

          {/* Staged rows — list of products the dispatcher queued for
              this add batch. Remove icon dequeues; the whole list is
              POSTed together on Save. */}
          {addRows.length === 0 ? (
            <Box sx={{ textAlign: 'center', color: '#1F1F1F99', fontSize: 13, py: 3, border: '1px dashed rgba(31,31,31,0.2)', borderRadius: 1 }}>
              No products staged yet. Pick a product and quantity above, then Add.
            </Box>
          ) : (
            <TableContainer sx={{ border: '1px solid rgba(31,31,31,0.15)', borderRadius: 1 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: '#FFFBE6' }}>
                    <TableCell sx={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: '#1F1F1F99' }}>Product</TableCell>
                    <TableCell align="right" sx={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: '#1F1F1F99', width: 90 }}>Qty</TableCell>
                    <TableCell sx={{ width: 40 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {addRows.map((row, idx) => {
                    const p = (productsQuery.data?.items ?? []).find(pp => pp.id === row.productId)
                    return (
                      <TableRow key={row.productId}>
                        <TableCell sx={{ fontSize: 13 }}>
                          <strong>{p?.name ?? '?'}</strong>
                          <Box component="span" sx={{ ml: 1, fontSize: 11, color: '#1F1F1F99' }}>{p?.code}</Box>
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: 13, fontWeight: 700 }}>{row.requestedQty}</TableCell>
                        <TableCell align="center">
                          <IconButton
                            size="small"
                            onClick={() => setAddRows(prev => prev.filter((_, i) => i !== idx))}
                            aria-label="Remove from list"
                            sx={{ color: '#C62828' }}
                          >
                            <X className="w-3.5 h-3.5" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {addItemsMutation.isError && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {(addItemsMutation.error as Error)?.message ?? 'Failed to add products.'}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button
            onClick={() => setAddOpen(false)}
            disabled={addItemsMutation.isPending}
            sx={{ textTransform: 'none', fontWeight: 600, color: '#1F1F1F' }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={async () => {
              if (addRows.length === 0) return
              try {
                await addItemsMutation.mutateAsync({
                  id: request.id,
                  req: { items: addRows },
                })
                setAddOpen(false)
              } catch { /* surfaced in Alert above */ }
            }}
            disabled={addRows.length === 0 || addItemsMutation.isPending}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {addItemsMutation.isPending ? 'Adding…' : `Add ${addRows.length} to request`}
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
      sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFF8E1', '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' } }}>
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
