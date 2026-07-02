import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, PackageCheck, Check, Printer, X, Undo2, Plus, Trash2, Hourglass } from 'lucide-react'
import {
  Alert, Autocomplete, Badge, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Paper, Table, TableBody, TableCell, TableContainer,
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
  useMoveToBackorder,
} from '../../hooks/useStockRequests'
import { useProducts } from '../../hooks/useProducts'
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
import { UnsavedChangesDialog } from '../../components/UnsavedChangesDialog'
import type { RequestStatus } from '../../api/stock-requests/types'
import { ValidationError } from '../../api/errors'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import { buildRootLookup, sortRootCategoryNames } from '../../utils/rootCategoryPriority'
import { useCategories } from '../../hooks/useCategories'

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
  const addItemsMutation     = useInventoryAddItems()
  const removeItemMutation   = useInventoryRemoveItem()
  const moveToBackorderMutation = useMoveToBackorder()
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
  // Move-to-back-order dialog (02-Jul-2026). Godown selects items to carve
  // off into a Backorder sibling; vendor-procured lines pre-check by default.
  const [backorderOpen, setBackorderOpen] = useState(false)
  const [backorderSelected, setBackorderSelected] = useState<Set<string>>(new Set())
  const [backorderEta, setBackorderEta] = useState<string>('')  // YYYY-MM-DD, blank = "no ETA yet"
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
                            type="number"
                            size="small"
                            value={dispatchQtys.get(item.id) ?? ''}
                            onChange={e => setItemQty(item.id, e.target.value, item.requestedQty)}
                            onKeyDown={e => { if (['e', 'E', '+', '-', '.', ','].includes(e.key)) e.preventDefault() }}
                            slotProps={{ htmlInput: { min: 0, inputMode: 'numeric', style: { textAlign: 'center', padding: '4px 8px' } } }}
                            sx={{
                              width: 86,
                              '& .MuiOutlinedInput-root': {
                                bgcolor: isShort ? '#FFEBEE' : isOver ? '#FFE0B2' : '#FFF8DC',
                                '& fieldset': { borderColor: isShort ? '#C62828' : isOver ? '#E65100' : '#1F1F1F' },
                              },
                            }}
                          />
                        ) : (
                          <DispatchedCell qty={item.dispatchedQty} requested={item.requestedQty} />
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

      {/* Add Products + Move to Back-order — appear only when the request
          is still editable (Pending / Approved, Order-only). */}
      {canAddItems && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 1.5 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Hourglass className="w-4 h-4" />}
            onClick={() => {
              // Pre-check every vendor-procured item so the godown only has
              // to un-check ones they DO have in stock. Blank ETA on open.
              const preChecked = new Set(
                items.filter(it => it.isVendorProcured).map(it => it.id),
              )
              setBackorderSelected(preChecked)
              setBackorderEta('')
              setBackorderOpen(true)
            }}
            sx={{
              textTransform: 'none', fontWeight: 700,
              bgcolor: '#FFE0B2', color: '#7C4A00',
              borderColor: '#E8A758', borderWidth: '1.5px',
              '&:hover': { bgcolor: '#FFCC80', borderColor: '#C68B3D', borderWidth: '1.5px' },
            }}
          >
            Move to Back-order
          </Button>
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

      {/* Back-order children banner (02-Jul-2026). Shown on the PARENT
          Order once the godown has carved off one or more Backorder
          siblings. Amber to match the vendor-procured badge; click the
          child code to jump to its detail page. */}
      {request.backorderChildren && request.backorderChildren.length > 0 && (
        <Paper
          elevation={0}
          sx={{
            p: 1.5,
            mb: 2,
            borderRadius: 2,
            bgcolor: '#FFE0B2',
            border: '1px solid #E8A758',
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            flexWrap: 'wrap',
          }}
        >
          <Hourglass className="w-5 h-5" style={{ color: '#7C4A00' }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ fontSize: 13, fontWeight: 700, color: '#7C4A00' }}>
              {request.backorderChildren.reduce((s, c) => s + c.totalItems, 0)} item{request.backorderChildren.reduce((s, c) => s + c.totalItems, 0) === 1 ? '' : 's'} on back-order
            </Box>
            <Box sx={{ fontSize: 12, color: '#7C4A00CC', display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              tracking as
              {request.backorderChildren.map((c, i) => (
                <Fragment key={c.id}>
                  <Box
                    component="span"
                    onClick={() => navigate(`/inventory/requests/${c.id}`)}
                    sx={{ fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}
                  >
                    {c.code}
                  </Box>
                  {c.expectedArrivalAt && (
                    <Box component="span" sx={{ fontStyle: 'italic' }}>
                      (ETA {new Date(c.expectedArrivalAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})
                    </Box>
                  )}
                  {i < request.backorderChildren!.length - 1 && ','}
                </Fragment>
              ))}
            </Box>
          </Box>
        </Paper>
      )}

      {/* If THIS request is a Backorder — banner linking back to parent. */}
      {request.parentRequestId && (
        <Paper
          elevation={0}
          sx={{
            p: 1.5,
            mb: 2,
            borderRadius: 2,
            bgcolor: '#FFE0B2',
            border: '1px solid #E8A758',
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <Hourglass className="w-5 h-5" style={{ color: '#7C4A00' }} />
          <Box sx={{ flex: 1 }}>
            <Box sx={{ fontSize: 13, fontWeight: 700, color: '#7C4A00' }}>
              Back-order carved from{' '}
              <Box
                component="span"
                onClick={() => navigate(`/inventory/requests/${request.parentRequestId}`)}
                sx={{ textDecoration: 'underline', cursor: 'pointer' }}
              >
                {request.parentRequestCode}
              </Box>
            </Box>
            {request.expectedArrivalAt && (
              <Box sx={{ fontSize: 12, color: '#7C4A00CC' }}>
                ETA {new Date(request.expectedArrivalAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </Box>
            )}
          </Box>
        </Paper>
      )}

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

      {/* Move-to-Back-order dialog (02-Jul-2026). Godown selects items to
          carve off into a linked Backorder sibling. Vendor-procured lines
          pre-check on open. ETA is optional. The parent's items list is
          updated in place (moved lines removed); a "N items on back-order"
          banner appears above the parent's items to point at the child. */}
      <Dialog
        open={backorderOpen}
        onClose={(_e, reason) => {
          if (reason === 'backdropClick' || moveToBackorderMutation.isPending) return
          setBackorderOpen(false)
        }}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3 } } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 700 }}>
          Move items to back-order — {request.code}
          <IconButton size="small" onClick={() => setBackorderOpen(false)} disabled={moveToBackorderMutation.isPending}>
            <X className="w-4 h-4" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ fontSize: 12, color: '#1F1F1F99', mb: 1.5 }}>
            Selected items will be moved to a new back-order (<strong>{request.code}-B</strong>) that
            you'll fulfil later once the vendor ships them. Shop will see both requests linked.
          </Box>
          <Box sx={{ maxHeight: 320, overflowY: 'auto', border: '1px solid rgba(31,31,31,0.15)', borderRadius: 1, mb: 2 }}>
            {items.map(it => (
              <Box
                key={it.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 0.75,
                  borderBottom: '1px solid rgba(31,31,31,0.08)',
                  bgcolor: it.isVendorProcured ? '#FFF8E1' : 'transparent',
                  '&:last-child': { borderBottom: 'none' },
                }}
              >
                <Checkbox
                  size="small"
                  checked={backorderSelected.has(it.id)}
                  onChange={(_e, checked) => {
                    setBackorderSelected(prev => {
                      const n = new Set(prev)
                      if (checked) n.add(it.id); else n.delete(it.id)
                      return n
                    })
                  }}
                  disabled={moveToBackorderMutation.isPending}
                  sx={{ p: 0.5 }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ fontSize: 13, fontWeight: 600, color: '#1F1F1F', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    {it.productName}
                    {it.isVendorProcured && (
                      <Chip
                        label="Vendor"
                        size="small"
                        sx={{
                          height: 18, fontSize: 10, fontWeight: 700,
                          bgcolor: '#FFE0B2', color: '#7C4A00',
                          border: '1px solid #E8A758',
                        }}
                      />
                    )}
                  </Box>
                  <Box sx={{ fontSize: 11, color: '#1F1F1F99' }}>
                    {it.productCode} · qty {it.requestedQty}
                    {it.weightValue != null ? ` · ${it.weightValue} ${it.weightUnit ?? ''}` : ''}
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
          <TextField
            label="Expected arrival (ETA)"
            type="date"
            value={backorderEta}
            onChange={e => setBackorderEta(e.target.value)}
            size="small"
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
            helperText="Optional — leave blank if the vendor hasn't confirmed yet."
            disabled={moveToBackorderMutation.isPending}
          />
          {moveToBackorderMutation.isError && (
            <Alert severity="error" sx={{ mt: 1.5, whiteSpace: 'pre-line' }}>
              {flatErr(moveToBackorderMutation.error) ?? 'Could not move items to back-order.'}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            onClick={() => setBackorderOpen(false)}
            variant="outlined"
            disabled={moveToBackorderMutation.isPending}
            sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#1F1F1F', color: '#1F1F1F' }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={
              moveToBackorderMutation.isPending
              || backorderSelected.size === 0
              || backorderSelected.size === items.length
            }
            title={
              backorderSelected.size === 0
                ? 'Select at least one item'
                : backorderSelected.size === items.length
                  ? 'You cannot move every item — the parent request would be empty'
                  : undefined
            }
            onClick={async () => {
              // Convert YYYY-MM-DD → ISO at IST midnight so PG stores a
              // sensible timestamptz (blank = null = "no ETA yet").
              let iso: string | null = null
              if (backorderEta) {
                // Parse as IST — midnight IST is 18:30 UTC of the previous day.
                iso = new Date(`${backorderEta}T00:00:00+05:30`).toISOString()
              }
              try {
                await moveToBackorderMutation.mutateAsync({
                  id: request.id,
                  req: {
                    itemIds: Array.from(backorderSelected),
                    expectedArrivalAt: iso,
                  },
                })
                setBackorderOpen(false)
              } catch {
                // Alert surfaces above
              }
            }}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {moveToBackorderMutation.isPending
              ? 'Moving…'
              : `Move ${backorderSelected.size} to back-order`}
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
