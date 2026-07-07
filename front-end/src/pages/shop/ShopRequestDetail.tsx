import { Fragment, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, PackageCheck, Clock, ShieldX, Edit2, Printer, Star, X as XIcon, Check } from 'lucide-react'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Tooltip,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import { DispatchedCell } from '../../components/DispatchedCell'
import { InvBadge } from '../../components/InvBadge'
import { RequestSummary } from '../../components/RequestSummary'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import {
  useStockRequest, useCancelStockRequest, useReceiveStockRequest, useSetSpecial,
} from '../../hooks/useStockRequests'
import { useSettings } from '../../hooks/useSettings'
import type { RequestStatus } from '../../api/stock-requests/types'
import { ValidationError } from '../../api/errors'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import { buildRootLookup, sortRootCategoryNames } from '../../utils/rootCategoryPriority'
import { useCategories } from '../../hooks/useCategories'

// Consolidated into utils/statusChipStyle.ts so a color tweak lands in one place.
import { STATUS_COLOR, STATUS_CHIP_SX } from '../../utils/statusChipStyle'

export default function ShopRequestDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: request, isLoading, error } = useStockRequest(id)
  const cancelMutation  = useCancelStockRequest()
  const receiveMutation = useReceiveStockRequest()
  const setSpecialMutation = useSetSpecial()
  // Inline edit state for the special_label. Enters edit mode when the
  // shop clicks the pencil next to the amber Special chip. SP-side gate
  // (fn_request_set_special) already restricts to status = 'Pending', but
  // we hide the pencil under the same rule for a clean UX.
  const [labelEditing, setLabelEditing] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const [labelErr, setLabelErr] = useState<string | null>(null)

  const cancelLabelEdit = () => {
    setLabelEditing(false)
    setLabelDraft('')
    setLabelErr(null)
  }

  const saveLabel = async () => {
    if (!request) return
    const trimmed = labelDraft.trim()
    setLabelErr(null)
    try {
      await setSpecialMutation.mutateAsync({
        id: request.id,
        // isSpecial stays true — only editing the name here. The toggle-
        // off path lives in ShopRequestNew.tsx's review dialog to keep
        // this strip purely about labelling.
        req: { isSpecial: true, specialLabel: trimmed || null },
      })
      setLabelEditing(false)
    } catch (e) {
      setLabelErr(
        e instanceof ValidationError ? e.flatten()
        : e instanceof Error          ? e.message
        : 'Could not save the label. Try again.',
      )
    }
  }
  // App settings — used to gate the editable-window chip below. When admin
  // has toggled request_lock_enabled = false, neither the countdown nor the
  // "Locked — admin only" chip is meaningful, so we drop the whole block.
  const settingsQuery = useSettings()
  const lockEnabled = (settingsQuery.data ?? [])
    .find(s => s.key === 'request_lock_enabled')?.value?.toLowerCase() !== 'false'
  const [cancelOpen, setCancelOpen]   = useState(false)
  const [receiveOpen, setReceiveOpen] = useState(false)
  // Confirm-receipt dialog state (02-Jul-2026). Keyed by item.id → the
  // qty the shop actually counted. Absence = "use dispatched as-is".
  // Presence with a diff = discrepancy (short if < dispatched, over if >).
  const [receivedQtys, setReceivedQtys] = useState<Map<string, number>>(new Map())

  // Split into out-of-stock (dispatched_qty === 0) vs the rest. Godown
  // marks a line 0 when they were out of stock at dispatch time — those
  // items don't belong in the main products grid (they didn't ship) but
  // shop still needs to see they weren't fulfilled. Rendered in a compact
  // section above the fixed footer instead. 02-Jul-2026.
  //
  // dispatched_qty === null (pre-dispatch) is kept in the main list.
  const outOfStockItems = useMemo(
    () => (request?.items ?? []).filter(it => it.dispatchedQty === 0),
    [request?.items],
  )
  const visibleItems = useMemo(
    () => (request?.items ?? []).filter(it => it.dispatchedQty !== 0),
    [request?.items],
  )

  // Always compute the grouped items, even when `request` is still loading —
  // hooks order must stay stable across renders. The empty input → empty array.
  const grouped = useMemo(
    () => groupByCategoryWeight(
      visibleItems,
      it => ({ category: it.categoryName, weightValue: it.weightValue, weightUnit: it.weightUnit }),
    ),
    [visibleItems],
  )

  // Two-level grouping: outer = root category (1 KG Snacks, Pickle/Thokku/Podi, …)
  // in hard-coded priority order; inner = leaf-cat cards (existing layout).
  // Lets the items grid read with the same top-level hierarchy the shop uses
  // when picking products on the new-request page (30-Jun-2026 client req).
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
        // Total product count across the root — surfaced in the legend so
        // the user can size up a section at a glance.
        const productCount = children.reduce(
          (sum, cg) => sum + cg.weightGroups.reduce((s, wg) => s + wg.items.length, 0),
          0,
        )
        return { root, children, productCount }
      })
  }, [grouped, categoriesQuery.data])

  // Flat item list in the same root-priority order used everywhere else.
  // Drives the confirm-receipt dialog so its row order matches what the
  // shop already scanned on the detail page above.
  const orderedItems = useMemo(() => {
    const out: NonNullable<typeof request>['items'] = [] as any
    for (const rg of rootGroups) {
      for (const cg of rg.children) {
        for (const wg of cg.weightGroups) {
          for (const it of wg.items) (out as any[]).push(it)
        }
      }
    }
    return out ?? []
  }, [rootGroups])

  // Layout note: cards are placed into a CSS `column-count` container below,
  // so the browser auto-balances them across 2 columns (1 on mobile). No
  // manual left/right split needed — `break-inside: avoid` on each card keeps
  // categories intact while column heights stay close.

  if (isLoading) {
    return (
      <Box>
        <PageHeader title="Loading…" subtitle="" />
      </Box>
    )
  }
  if (error || !request) {
    return (
      <Box>
        <PageHeader
          title="Request not found"
          subtitle="It may have been deleted or you don't have access."
          action={<BackButton onClick={() => navigate('/shop/requests')} />}
        />
        <Alert severity="error">
          {error instanceof Error ? error.message : 'Could not load request.'}
        </Alert>
      </Box>
    )
  }

  const now = new Date()
  const editableUntil = new Date(request.editableUntil)
  const inEditWindow = now < editableUntil
  const msLeft = editableUntil.getTime() - now.getTime()
  const hoursLeft = Math.max(0, Math.floor(msLeft / 3_600_000))
  const minsLeft  = Math.max(0, Math.floor((msLeft % 3_600_000) / 60_000))

  // When admin has turned off request_lock_enabled, treat every Pending
  // request as still inside its edit window — even legacy rows whose stored
  // editable_until is already in the past.
  const effectiveInWindow = inEditWindow || !lockEnabled
  const canEdit    = request.status === 'Pending' && effectiveInWindow
  // Cancel narrowed to Pending only (01-Jul-2026): once the godown has
  // accepted a request they've committed prep effort, and a silent
  // shop-side cancel would waste that. Shop must call the godown to
  // revoke approval first (Inventory / Admin have Revoke buttons), then
  // the request is back in Pending and can be cancelled here.
  const canCancel  = request.status === 'Pending' && effectiveInWindow
  const canReceive = request.status === 'Dispatched'

  const cancelError =
    cancelMutation.error instanceof ValidationError ? cancelMutation.error.flatten()
    : cancelMutation.error instanceof Error ? cancelMutation.error.message : null
  const receiveError =
    receiveMutation.error instanceof ValidationError ? receiveMutation.error.flatten()
    : receiveMutation.error instanceof Error ? receiveMutation.error.message : null

  const handleCancel = async () => {
    try { await cancelMutation.mutateAsync(request.id) }
    finally { setCancelOpen(false) }
  }

  const handleReceive = async () => {
    // Only lines where the shop's count differs from the dispatched qty
    // are sent. Everything else stays as "no discrepancy noted" on the
    // DB side (received_qty column stays NULL). Empty diff-list = the
    // one-click "as-dispatched" fast path.
    const diffItems = (request.items ?? [])
      .filter(it => {
        const typed = receivedQtys.get(it.id)
        return typed != null && typed !== (it.dispatchedQty ?? 0)
      })
      .map(it => ({ id: it.id, receivedQty: receivedQtys.get(it.id)! }))
    const payload = diffItems.length > 0 ? { items: diffItems } : undefined
    try {
      await receiveMutation.mutateAsync({ id: request.id, req: payload })
    } finally {
      setReceiveOpen(false)
      setReceivedQtys(new Map())
    }
  }

  // Card renderer — extracted so both columns of the 2-col grid can call it
  // without duplicating 80 lines of JSX. Closes over formatINR / DispatchedCell
  // from the outer scope, no extra props needed.
  const renderCatGroup = (catGroup: typeof grouped[number]) => (
    <Paper
      key={catGroup.category}
      elevation={0}
      sx={{ mb: 2, borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFF8DC', overflow: 'hidden' }}
    >
      {/* Category header — metallic gold gradient (#C28A00 → #FFD700 → #FFF1A6)
          with dark text. Luxury brand-feel sweep; no dark stops so the bar
          reads warm + premium against the cream weight strip below. */}
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
          {/* Column headers row (30-Jun-2026 client req) — surfaces what
              the four numeric columns represent. Same widths as the body
              cells below so alignment lines up. */}
          <TableHead>
            <TableRow sx={{ bgcolor: '#FFFBE6' }}>
              <TableCell sx={{ py: 0.75, pl: 3, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', borderBottom: '1px solid rgba(31,31,31,0.15)' }}>Product</TableCell>
              <TableCell align="right" sx={{ py: 0.75, width: 90,  fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', borderBottom: '1px solid rgba(31,31,31,0.15)' }}>Req Qty</TableCell>
              <TableCell align="right" sx={{ py: 0.75, width: 100, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', borderBottom: '1px solid rgba(31,31,31,0.15)' }}>Disp Qty</TableCell>
              <TableCell align="right" sx={{ py: 0.75, width: 110, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', borderBottom: '1px solid rgba(31,31,31,0.15)' }}>MRP</TableCell>
              <TableCell align="right" sx={{ py: 0.75, width: 120, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', borderBottom: '1px solid rgba(31,31,31,0.15)' }}>Net Amt</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {catGroup.weightGroups.map((wg, wIdx) => (
              <Fragment key={`${catGroup.category}__${wg.label}`}>
                {/* Weight strip — yellow-tinted with yellow left-edge. */}
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
                  // Subtotal reflects effective qty × price. Post-dispatch
                  // that's dispatched_qty; pre-dispatch falls back to
                  // requested_qty so the column stays meaningful.
                  const effectiveQty = item.dispatchedQty ?? item.requestedQty
                  const effectiveSubtotal = effectiveQty * item.unitPrice
                  const short = item.dispatchedQty != null && item.dispatchedQty < item.requestedQty
                  // Over-dispatch — godown sent more than the shop requested.
                  // Tinted amber (vs red for short) so the shop user can scan
                  // and tell under/over apart at a glance. 29-Jun-2026.
                  const over  = item.dispatchedQty != null && item.dispatchedQty > item.requestedQty
                  // Row tint pairs with the qty + total colour so a row
                  // reads as one signal — not just one coloured cell.
                  const rowBg = short ? 'rgba(198,40,40,0.06)'
                              : over  ? 'rgba(230,81,0,0.07)'
                              : 'transparent'
                  const totalColor = short ? '#C62828' : over ? '#E65100' : '#1F1F1F'
                  return (
                    <TableRow key={item.id} hover sx={{ bgcolor: rowBg, '& > td': { verticalAlign: 'top' } }}>
                      <TableCell sx={{ pl: 3, py: 1.25 }}>
                        <Box sx={{ fontWeight: 600, fontSize: 14 }}>
                          {item.productName}
                          {item.addedBy === 'Inventory' && <InvBadge />}
                          {/* Partial-weight return chip (02-Jul-2026, B2).
                              Only on Returns where the shop claimed a
                              fraction of a pack. */}
                          {item.returnWeightG != null && (
                            <Chip
                              label={`Partial · ${item.returnWeightG}g`}
                              size="small"
                              sx={{
                                ml: 1,
                                bgcolor: '#FFE0B2', color: '#7C4A00',
                                border: '1px solid #E8A758',
                                height: 20, fontSize: 10, fontWeight: 700,
                              }}
                            />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ py: 1.25, width: 90 }}>{item.requestedQty}</TableCell>
                      <TableCell align="right" sx={{ py: 1.25, width: 100 }}>
                        <DispatchedCell qty={item.dispatchedQty} requested={item.requestedQty} received={item.receivedQty} />
                      </TableCell>
                      <TableCell align="right" sx={{ py: 1.25, width: 110 }}>{formatINR(item.unitPrice)}</TableCell>
                      <TableCell align="right" sx={{ py: 1.25, width: 120, fontWeight: 600, color: totalColor, whiteSpace: 'nowrap' }}>
                        {formatINR(effectiveSubtotal)}
                      </TableCell>
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
    // pb leaves room for the fixed summary bar at the bottom + extra
    // breathing space above it so the Edit / Cancel / Receive action
    // buttons don't sit flush against the footer (19-Jun-2026, client #14).
    <Box sx={{ pb: 16 }}>
      <PageHeader
        title={request.code}
        subtitle={`${request.shopCode} ${request.shopName} → ${request.inventoryCode} ${request.inventoryName}`}
        action={
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="outlined"
              startIcon={<Printer className="w-4 h-4" />}
              // Shop user prints on the shop's 3" thermal printer — route to
              // the thermal layout. Admin/Inventory still use the A4 picklist
              // route (/print/request/:id) from their respective detail pages.
              onClick={() => window.open(`/print/request/${request.id}/thermal`, '_blank', 'noopener,noreferrer')}
              sx={{
                textTransform: 'none', fontWeight: 600,
                borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFF8E1',
                '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
              }}
            >
              Print
            </Button>
            <BackButton onClick={() => navigate('/shop/requests')} />
          </Box>
        }
      />

      {/* Status & countdown row */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2, alignItems: 'center' }}>
        <Chip
          label={request.status}
          color={STATUS_COLOR[request.status]}
          variant={request.status === 'Received' || request.status === 'Accepted' ? 'filled' : 'outlined'}
          size="small"
          sx={{ fontWeight: 700, ...STATUS_CHIP_SX[request.status] }}
        />
        {/* Return pill — same red as the Return Stock submit button + the
            list-page pill. Visible only on Return-type requests so the user
            knows at a glance this isn't a normal order. */}
        {request.requestType === 'Return' && (
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
        {/* Editable-window chip is an Order concept (daily cutoff) and only
            relevant while the lock is enabled in app_settings. Returns set
            editable_until 100 years out so the countdown is nonsensical; when
            lock is disabled, the whole concept goes away. Both cases → drop
            the chip entirely. */}
        {lockEnabled && request.requestType === 'Order' && request.status === 'Pending' && (
          inEditWindow ? (
            <Chip
              icon={<Clock className="w-3.5 h-3.5" />}
              label={`Editable for ${hoursLeft}h ${minsLeft}m`}
              color="warning"
              variant="outlined"
              size="small"
            />
          ) : (
            <Chip
              icon={<ShieldX className="w-3.5 h-3.5" />}
              label="Locked — admin only"
              color="default"
              variant="outlined"
              size="small"
            />
          )
        )}
      </Box>

      {/* Rejection callout */}
      {request.status === 'Rejected' && request.rejectionReason && (
        <Alert severity="error" sx={{ mb: 2 }}>
          <strong>Rejected:</strong> {request.rejectionReason}
        </Alert>
      )}

      {/* Special Request strip (06-Jul-2026). Renders only when the shop
          flagged this request. Label shows as-is; a pencil affordance
          appears while status = 'Pending' so the shop can edit the name
          in place (BE's fn_request_set_special enforces the same gate).
          Once Approved, the label freezes — the strip stays but the pencil
          disappears, matching the client's contract-freezing rule. */}
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
          {labelEditing ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 240 }}>
              <TextField
                value={labelDraft}
                onChange={e => setLabelDraft(e.target.value.slice(0, 120))}
                size="small"
                autoFocus
                placeholder="e.g. Diwali stock 2026"
                slotProps={{ htmlInput: { maxLength: 120 } }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); void saveLabel() }
                  if (e.key === 'Escape') { cancelLabelEdit() }
                }}
                disabled={setSpecialMutation.isPending}
                sx={{
                  flex: 1,
                  bgcolor: '#FFF8DC',
                  borderRadius: 1,
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#3E2500' },
                }}
              />
              <Tooltip title="Save">
                <span>
                  <IconButton
                    size="small"
                    onClick={() => void saveLabel()}
                    disabled={setSpecialMutation.isPending}
                    sx={{ bgcolor: '#3E2500', color: '#FFFFFF', '&:hover': { bgcolor: '#5D3600' } }}
                  >
                    <Check className="w-4 h-4" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Cancel">
                <span>
                  <IconButton
                    size="small"
                    onClick={cancelLabelEdit}
                    disabled={setSpecialMutation.isPending}
                    sx={{ color: '#3E2500' }}
                  >
                    <XIcon className="w-4 h-4" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          ) : (
            <>
              <Box sx={{
                px: 1, py: 0.25, borderRadius: 1,
                bgcolor: '#FFF8DC', border: '1px solid #3E2500',
                fontWeight: 700, color: '#3E2500', fontSize: 13,
                maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {request.specialLabel?.trim() || 'Unnamed special'}
              </Box>
              {request.status === 'Pending' && (
                <Tooltip title="Edit label">
                  <IconButton
                    size="small"
                    onClick={() => {
                      setLabelDraft(request.specialLabel ?? '')
                      setLabelErr(null)
                      setLabelEditing(true)
                    }}
                    sx={{ color: '#3E2500', p: 0.5 }}
                  >
                    <Edit2 className="w-4 h-4" />
                  </IconButton>
                </Tooltip>
              )}
            </>
          )}
          {labelErr && (
            <Box sx={{ fontSize: 12, color: '#B00020', width: '100%' }}>{labelErr}</Box>
          )}
        </Paper>
      )}

      {/* Post-receipt discrepancy recap (02-Jul-2026). Quiet reminder to
          shop staff of what they submitted; admin + inv see the same
          banner on their views. Skips render when everything matched. */}
      {(() => {
        const items = request.items ?? []
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
            <strong>You reported a discrepancy at receipt.</strong>{' '}
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

      {/* Timeline */}
      <Paper elevation={0} sx={{ p: 2, mb: 2, borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFF8DC' }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2 }}>
          {/* Approval step removed — Submitted → Dispatched → Received. */}
          <TimelineItem label="Submitted"  value={formatIstDateTime(request.submittedAt)}  by={request.submittedByName}  done />
          <TimelineItem label="Dispatched" value={formatIstDateTime(request.dispatchedAt)} by={request.dispatchedByName} done={!!request.dispatchedAt} />
          <TimelineItem
            label={request.status === 'Cancelled' ? 'Cancelled' : request.status === 'Rejected' ? 'Rejected' : 'Received'}
            value={formatIstDateTime(
              request.status === 'Cancelled' ? request.cancelledAt :
              request.status === 'Rejected'  ? null :
              request.receivedAt
            )}
            by={request.status === 'Received' ? request.receivedByName : null}
            done={['Received', 'Cancelled', 'Rejected'].includes(request.status)}
          />
        </Box>
      </Paper>

      {/* Items — grouped under root-category sections in hard-coded priority
          order (1 KG Snacks → Packing Items → … → Shop Needs). Each root
          gets a cream banner strip on top with the name + product count
          centered, then its leaf-cat cards flow into a 2-col grid below.
          (30-Jun-2026: switched from fieldset/legend → flat banner per
          client feedback — the dashed-border wrapper read as disconnected
          from the centered title.) */}
      <Box sx={{ mb: 3 }}>
        {rootGroups.map(rg => (
          <Box key={rg.root} sx={{ mb: 2.5 }}>
            <Box
              sx={{
                // Brand gold gradient — same stops as the primary CTA in the
                // app. Richer than the sub-cat banners' solid #FCD835, so the
                // root tier reads as the dominant header at a glance.
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

      {/* Out-of-stock strip (02-Jul-2026). Compact list of every line the
          godown dispatched at qty=0. Excluded from the main products grid
          above so scanning the "what we actually got" list isn't cluttered
          with empty lines. Only surfaces after dispatch. */}
      {outOfStockItems.length > 0 && (
        <Paper
          elevation={0}
          sx={{
            mb: 2,
            borderRadius: 2,
            border: '1px solid #C62828',
            overflow: 'hidden',
          }}
        >
          <Box sx={{
            px: 2, py: 1,
            bgcolor: '#FFEBEE',
            borderBottom: '1px solid #C62828',
            fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: '#C62828',
          }}>
            Out of stock · {outOfStockItems.length} {outOfStockItems.length === 1 ? 'product' : 'products'} not dispatched
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FFF5F5' }}>
                <TableCell sx={{ py: 0.75, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#7F1D1D' }}>Product</TableCell>
                <TableCell align="right" sx={{ py: 0.75, width: 100, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#7F1D1D' }}>Req'd</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {outOfStockItems.map(it => (
                <TableRow key={it.id}>
                  <TableCell sx={{ py: 0.9, fontSize: 13, fontWeight: 600, color: '#1F1F1F' }}>
                    {it.productName}
                  </TableCell>
                  <TableCell align="right" sx={{ py: 0.9, fontSize: 13, fontWeight: 700, color: '#7F1D1D' }}>
                    {it.requestedQty}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* Receipt-change log (02-Jul-2026). Compact table listing every line
          where the shop's confirm-receipt count differed from the godown's
          dispatched qty. Only surfaces when at least one item has
          receivedQty set — otherwise the whole block is hidden. Sits
          above the fixed footer so the shop can scroll to it as a quick
          "what did I change?" reference. */}
      {(() => {
        const changed = (request.items ?? []).filter(it => it.receivedQty != null)
        if (changed.length === 0) return null
        return (
          <Paper
            elevation={0}
            sx={{
              mb: 2,
              borderRadius: 2,
              border: '1px solid rgba(31,31,31,0.2)',
              overflow: 'hidden',
            }}
          >
            <Box sx={{
              px: 2, py: 1,
              bgcolor: '#FFF8DC',
              borderBottom: '1px solid rgba(31,31,31,0.2)',
              fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: '#1F1F1F',
            }}>
              Receipt changes · {changed.length} {changed.length === 1 ? 'product' : 'products'}
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
                      <TableCell sx={{ py: 0.9, fontSize: 13, fontWeight: 600 }}>
                        {it.productName}
                      </TableCell>
                      <TableCell align="right" sx={{ py: 0.9, fontSize: 13 }}>
                        {disp}
                      </TableCell>
                      <TableCell align="right" sx={{ py: 0.9, fontSize: 13, fontWeight: 700, color: short ? '#C62828' : over ? '#E65100' : '#1F1F1F' }}>
                        {rec}
                      </TableCell>
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

      {/* Fixed summary bar — same pattern as the New Stock Request cart
          bar (sidebar-aware left offset, full-bleed right, elevation 6 for
          shadow). 19-Jun-2026 (client #14): totals stay anchored at the
          bottom edge regardless of scroll position. Outer Box has pb:12
          to keep page content from sliding underneath. */}
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
        }}
      >
        {/* Edit Items + Cancel Request row (07-Jul-2026, client req: mirror
            admin's footer action bar on the shop side). Renders only while
            the request is still editable. Sits above the summary row so
            the buttons stay reachable without scrolling — matches the
            AdminRequestDetail pattern. */}
        {(canEdit || canCancel) && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 1,
              flexWrap: 'wrap',
              px: { xs: 2, sm: 3 },
              py: 1,
              borderBottom: '1px solid rgba(31,31,31,0.15)',
              bgcolor: '#FFF8E1',
            }}
          >
            {canEdit && (
              <Button
                variant="outlined"
                startIcon={<Edit2 className="w-4 h-4" />}
                onClick={() => navigate(`/shop/requests/${request.id}/edit`)}
                sx={{
                  textTransform: 'none', fontWeight: 600,
                  borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFFFFF',
                  '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
                }}
              >
                Edit Items
              </Button>
            )}
            {canCancel && (
              <Button
                variant="outlined"
                startIcon={<Ban className="w-4 h-4" />}
                onClick={() => setCancelOpen(true)}
                disabled={cancelMutation.isPending}
                sx={{
                  textTransform: 'none', fontWeight: 600,
                  borderColor: '#C62828', color: '#C62828', bgcolor: '#FFFFFF',
                  '&:hover': { borderColor: '#C62828', bgcolor: 'rgba(198,40,40,0.05)' },
                }}
              >
                Cancel Request
              </Button>
            )}
          </Box>
        )}
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 1.5 }}>
        <RequestSummary
          request={request}
          variant="footer"
          // Shop user's primary action lives in the footer's center slot so
          // it's reachable without scrolling past the items grid (client #14
          // follow-up, 29-Jun-2026). Stays a no-op when canReceive is false
          // — RequestSummary skips the slot when actionSlot is undefined.
          actionSlot={canReceive ? (
            <Button
              variant="contained"
              // color="success" escapes the global MuiButton override in
              // theme.ts that paints variant="contained" color="primary"
              // gold. Using `background` (not `bgcolor`) so we beat the
              // theme's CSS shorthand, not just background-color longhand.
              color="success"
              startIcon={<PackageCheck className="w-4 h-4" />}
              onClick={() => {
                // Seed the dialog with dispatchedQty for every line so a
                // one-click confirm = "everything as-dispatched" (fast path).
                // Shop only touches rows where the count differed.
                const seed = new Map<string, number>()
                for (const it of request.items ?? []) {
                  seed.set(it.id, it.dispatchedQty ?? 0)
                }
                setReceivedQtys(seed)
                setReceiveOpen(true)
              }}
              disabled={receiveMutation.isPending}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                background: '#16A34A',
                color: '#FFFFFF',
                border: 'none',
                boxShadow: '0 2px 6px rgba(22,163,74,0.35)',
                '&:hover': { background: '#15803D', boxShadow: '0 3px 8px rgba(21,128,61,0.45)' },
                '&.Mui-disabled': { background: '#16A34A66', color: '#FFFFFFCC' },
              }}
            >
              Confirm Received
            </Button>
          ) : undefined}
        />
        </Box>
      </Paper>

      {/* Notes */}
      {request.notes && (
        <Paper elevation={0} sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: '#FFF8DC', border: '1px dashed #1F1F1F' }}>
          <Box sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', mb: 0.5 }}>Notes</Box>
          <Box sx={{ fontSize: 14, color: '#1F1F1F', whiteSpace: 'pre-wrap' }}>{request.notes}</Box>
        </Paper>
      )}

      {/* Action errors */}
      {cancelError  && <Alert severity="error" sx={{ mb: 1 }}>{cancelError}</Alert>}
      {receiveError && <Alert severity="error" sx={{ mb: 1 }}>{receiveError}</Alert>}

      {/* Edit + Cancel moved to the fixed footer's action row (07-Jul-2026,
          matching admin's pattern). Confirm Received still lives in the
          footer's center slot. See the Paper block above. */}

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this request?"
        message={`This will cancel ${request.code}. You'll need to create a new request if you change your mind.`}
        confirmLabel="Cancel Request"
        cancelLabel="Keep it"
        onConfirm={handleCancel}
        onCancel={() => setCancelOpen(false)}
      />
      {/* Confirm Receipt dialog (02-Jul-2026). Shop counts what actually
          landed before confirming. Pre-filled with dispatched qty on every
          line — one-click confirm = "all as-dispatched". Dial down for a
          short line, dial up for over-count. Damaged items still use the
          Return flow after receiving. */}
      <Dialog
        open={receiveOpen}
        onClose={(_e, reason) => {
          // No backdrop / escape close (global rule); only Cancel/X.
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') return
          if (receiveMutation.isPending) return
          setReceiveOpen(false)
        }}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3 } } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 700 }}>
          Confirm receipt — {request.code}
          <IconButton size="small" onClick={() => setReceiveOpen(false)} disabled={receiveMutation.isPending}>
            <XIcon className="w-4 h-4" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ fontSize: 12, color: '#1F1F1F99', mb: 1.5 }}>
            Count the goods before confirming. If short or extra, adjust
            the number below. Damaged units → submit a <strong>Return</strong> after
            confirming receipt.
          </Box>
          {(() => {
            // Compute totals for the summary strip. Shortlines / overlines
            // recomputed on every render from the live receivedQtys map.
            let shortLines = 0
            let overLines  = 0
            let shortUnits = 0
            let overUnits  = 0
            for (const it of orderedItems) {
              const disp   = it.dispatchedQty ?? 0
              const typed  = receivedQtys.get(it.id) ?? disp
              if (typed < disp) { shortLines++; shortUnits += (disp - typed) }
              if (typed > disp) { overLines++;  overUnits  += (typed - disp) }
            }
            return (
              <>
                <Box sx={{ maxHeight: 380, overflowY: 'auto', border: '1px solid rgba(31,31,31,0.15)', borderRadius: 1 }}>
                  {orderedItems.map(it => {
                    const disp    = it.dispatchedQty ?? 0
                    const typed   = receivedQtys.get(it.id) ?? disp
                    const short   = typed < disp
                    const over    = typed > disp
                    const rowBg   = short ? '#FFEBEE' : over ? '#FFE0B2' : 'transparent'
                    return (
                      <Box
                        key={it.id}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          px: 1.5,
                          py: 0.75,
                          borderBottom: '1px solid rgba(31,31,31,0.08)',
                          bgcolor: rowBg,
                          '&:last-child': { borderBottom: 'none' },
                        }}
                      >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Box sx={{ fontSize: 13, fontWeight: 600, color: '#1F1F1F' }}>
                            {it.productName}
                          </Box>
                          <Box sx={{ fontSize: 11, color: '#1F1F1F99' }}>
                            {it.productCode} · dispatched {disp}
                            {it.weightValue != null ? ` · ${it.weightValue} ${it.weightUnit ?? ''}` : ''}
                          </Box>
                        </Box>
                        {short && (
                          <Chip
                            label={`short ${disp - typed}`}
                            size="small"
                            sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: '#C62828', color: '#FFF' }}
                          />
                        )}
                        {over && (
                          <Chip
                            label={`+${typed - disp}`}
                            size="small"
                            sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: '#E65100', color: '#FFF' }}
                          />
                        )}
                        <TextField
                          type="text"
                          size="small"
                          // String-coerce so MUI doesn't switch from
                          // controlled to uncontrolled when the number 0
                          // (initial dispatched qty for a 0-OOS line, if
                          // it slipped through the filter) reads as
                          // falsy inside the input.
                          value={String(typed)}
                          onChange={e => {
                            const v = e.target.value
                            if (v === '') {
                              // Blank = 0 (shop got nothing on that line).
                              setReceivedQtys(prev => { const n = new Map(prev); n.set(it.id, 0); return n })
                              return
                            }
                            if (!/^\d+$/.test(v)) return
                            const parsed = parseInt(v, 10)
                            if (!Number.isFinite(parsed)) return
                            setReceivedQtys(prev => {
                              const n = new Map(prev)
                              n.set(it.id, parsed)
                              return n
                            })
                          }}
                          onKeyDown={e => {
                            if (['e', 'E', '.', ','].includes(e.key)) { e.preventDefault(); return }
                            // Keyboard stepper: + / - / ArrowUp / ArrowDown
                            // adjust the qty by 1. Handy for quick nudges
                            // when the shop's count is off by a few units.
                            if (e.key === '+' || e.key === '=' || e.key === 'ArrowUp') {
                              e.preventDefault()
                              setReceivedQtys(prev => {
                                const n = new Map(prev)
                                n.set(it.id, (n.get(it.id) ?? disp) + 1)
                                return n
                              })
                              return
                            }
                            if (e.key === '-' || e.key === 'ArrowDown') {
                              e.preventDefault()
                              setReceivedQtys(prev => {
                                const n = new Map(prev)
                                const cur = n.get(it.id) ?? disp
                                if (cur > 0) n.set(it.id, cur - 1)
                                return n
                              })
                            }
                          }}
                          onWheel={e => (e.target as HTMLInputElement).blur()}
                          onFocus={e => (e.target as HTMLInputElement).select()}
                          slotProps={{
                            htmlInput: {
                              inputMode: 'numeric',
                              style: { textAlign: 'center', padding: '4px 8px', width: 56 },
                            },
                          }}
                          sx={{
                            width: 76,
                            '& .MuiOutlinedInput-root': {
                              bgcolor: short ? '#FFCDD2' : over ? '#FFCC80' : '#FFF8DC',
                              '& fieldset': { borderColor: short ? '#C62828' : over ? '#E65100' : '#1F1F1F' },
                            },
                          }}
                        />
                      </Box>
                    )
                  })}
                </Box>

                {/* Summary strip — only surfaces when there's actually a discrepancy. */}
                {(shortLines > 0 || overLines > 0) && (
                  <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5, fontSize: 12, fontWeight: 700 }}>
                    {shortLines > 0 && (
                      <Box sx={{ color: '#C62828' }}>
                        ⚠ {shortLines} line{shortLines === 1 ? '' : 's'} short · {shortUnits} unit{shortUnits === 1 ? '' : 's'} missing
                      </Box>
                    )}
                    {overLines > 0 && (
                      <Box sx={{ color: '#E65100' }}>
                        ↑ {overLines} line{overLines === 1 ? '' : 's'} over · {overUnits} extra unit{overUnits === 1 ? '' : 's'}
                      </Box>
                    )}
                  </Box>
                )}
              </>
            )
          })()}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            onClick={() => setReceiveOpen(false)}
            variant="outlined"
            disabled={receiveMutation.isPending}
            sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#1F1F1F', color: '#1F1F1F' }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="success"
            startIcon={<PackageCheck className="w-4 h-4" />}
            disabled={receiveMutation.isPending}
            onClick={handleReceive}
            sx={{
              textTransform: 'none', fontWeight: 700,
              background: '#16A34A', color: '#FFFFFF',
              '&:hover': { background: '#15803D' },
            }}
          >
            {receiveMutation.isPending ? 'Confirming…' : 'Confirm receipt'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="outlined"
      startIcon={<ArrowLeft className="w-4 h-4" />}
      onClick={onClick}
      sx={{
        textTransform: 'none', fontWeight: 600,
        borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFF8E1',
        '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
      }}
    >
      Back to list
    </Button>
  )
}

function TimelineItem({ label, value, by, done }: { label: string; value: string; by?: string | null; done: boolean }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, p: 1.5, borderRadius: 1, bgcolor: done ? '#FFF8DC' : 'rgba(31,31,31,0.04)', border: '1px solid', borderColor: done ? '#FCD835' : 'rgba(31,31,31,0.1)' }}>
      <Box sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: done ? '#1F1F1F' : '#1F1F1F66' }}>{label}</Box>
      <Box sx={{ fontSize: 13, fontWeight: 600, color: done ? '#1F1F1F' : '#1F1F1F66' }}>{value}</Box>
      {done && by && (
        <Box sx={{ fontSize: 11, fontWeight: 500, color: '#1F1F1F99' }}>by {by}</Box>
      )}
    </Box>
  )
}
