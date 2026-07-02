import { Fragment, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, PackageCheck, Clock, ShieldX, Edit2, Printer } from 'lucide-react'
import {
  Alert, Box, Button, Chip, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import { DispatchedCell } from '../../components/DispatchedCell'
import { InvBadge } from '../../components/InvBadge'
import { RequestSummary } from '../../components/RequestSummary'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import {
  useStockRequest, useCancelStockRequest, useReceiveStockRequest,
} from '../../hooks/useStockRequests'
import { useSettings } from '../../hooks/useSettings'
import type { RequestStatus } from '../../api/stock-requests/types'
import { ValidationError } from '../../api/errors'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import { buildRootLookup, sortRootCategoryNames } from '../../utils/rootCategoryPriority'
import { useCategories } from '../../hooks/useCategories'

const STATUS_COLOR: Record<RequestStatus, 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
  // Drafts are reached via the dedicated draft endpoint, not the detail
  // route. The mapping exists only to satisfy the exhaustive Record type.
  Draft:      'default',
  Pending:    'warning',
  Approved:   'info',
  Rejected:   'error',
  Dispatched: 'primary',
  Received:   'success',
  Cancelled:  'default',
  // Returns' terminal state — green-success once goods are back at godown.
  Accepted:   'success',
}

export default function ShopRequestDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: request, isLoading, error } = useStockRequest(id)
  const cancelMutation  = useCancelStockRequest()
  const receiveMutation = useReceiveStockRequest()
  // App settings — used to gate the editable-window chip below. When admin
  // has toggled request_lock_enabled = false, neither the countdown nor the
  // "Locked — admin only" chip is meaningful, so we drop the whole block.
  const settingsQuery = useSettings()
  const lockEnabled = (settingsQuery.data ?? [])
    .find(s => s.key === 'request_lock_enabled')?.value?.toLowerCase() !== 'false'
  const [cancelOpen, setCancelOpen]   = useState(false)
  const [receiveOpen, setReceiveOpen] = useState(false)

  // Always compute the grouped items, even when `request` is still loading —
  // hooks order must stay stable across renders. The empty input → empty array.
  const grouped = useMemo(
    () => groupByCategoryWeight(
      request?.items ?? [],
      it => ({ category: it.categoryName, weightValue: it.weightValue, weightUnit: it.weightUnit }),
    ),
    [request?.items],
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
    try { await receiveMutation.mutateAsync(request.id) }
    finally { setReceiveOpen(false) }
  }

  // Card renderer — extracted so both columns of the 2-col grid can call it
  // without duplicating 80 lines of JSX. Closes over formatINR / DispatchedCell
  // from the outer scope, no extra props needed.
  const renderCatGroup = (catGroup: typeof grouped[number]) => (
    <Paper
      key={catGroup.category}
      elevation={0}
      sx={{ mb: 2, borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFFFFF', overflow: 'hidden' }}
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
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ py: 1.25, width: 90 }}>{item.requestedQty}</TableCell>
                      <TableCell align="right" sx={{ py: 1.25, width: 100 }}>
                        <DispatchedCell qty={item.dispatchedQty} requested={item.requestedQty} />
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
          sx={{ fontWeight: 700 }}
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

      {/* Back-order children banner (02-Jul-2026). Shown on the PARENT
          Order once godown has carved off Backorder siblings. */}
      {request.backorderChildren && request.backorderChildren.length > 0 && (
        <Paper
          elevation={0}
          sx={{
            p: 1.5, mb: 2, borderRadius: 2,
            bgcolor: '#FFE0B2', border: '1px solid #E8A758',
            display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ fontSize: 13, fontWeight: 700, color: '#7C4A00' }}>
              {request.backorderChildren.reduce((s, c) => s + c.totalItems, 0)} item{request.backorderChildren.reduce((s, c) => s + c.totalItems, 0) === 1 ? '' : 's'} on back-order
            </Box>
            <Box sx={{ fontSize: 12, color: '#7C4A00CC' }}>
              Godown is procuring these from vendors and will dispatch as{' '}
              {request.backorderChildren.map((c, i) => (
                <Fragment key={c.id}>
                  <Box
                    component="span"
                    onClick={() => navigate(`/shop/requests/${c.id}`)}
                    sx={{ fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}
                  >
                    {c.code}
                  </Box>
                  {c.expectedArrivalAt && (
                    <> (ETA {new Date(c.expectedArrivalAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})</>
                  )}
                  {i < request.backorderChildren!.length - 1 && ', '}
                </Fragment>
              ))}
              .
            </Box>
          </Box>
        </Paper>
      )}

      {/* If THIS request IS a Backorder — link back to parent. */}
      {request.parentRequestId && (
        <Paper
          elevation={0}
          sx={{
            p: 1.5, mb: 2, borderRadius: 2,
            bgcolor: '#FFE0B2', border: '1px solid #E8A758',
          }}
        >
          <Box sx={{ fontSize: 13, fontWeight: 700, color: '#7C4A00' }}>
            Back-order from your order{' '}
            <Box
              component="span"
              onClick={() => navigate(`/shop/requests/${request.parentRequestId}`)}
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
        </Paper>
      )}

      {/* Timeline */}
      <Paper elevation={0} sx={{ p: 2, mb: 2, borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFFFFF' }}>
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
          px: { xs: 2, sm: 3 },
          py: 1.5,
        }}
      >
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
              onClick={() => setReceiveOpen(true)}
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

      {/* Actions */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap' }}>
        {canEdit && (
          <Button
            variant="outlined"
            startIcon={<Edit2 className="w-4 h-4" />}
            onClick={() => navigate(`/shop/requests/${request.id}/edit`)}
            sx={{
              textTransform: 'none', fontWeight: 600,
              borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFF8E1',
              '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
            }}
          >
            Edit
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
              borderColor: '#C62828', color: '#C62828',
              '&:hover': { borderColor: '#C62828', bgcolor: 'rgba(198,40,40,0.05)' },
            }}
          >
            Cancel Request
          </Button>
        )}
        {/* Confirm Received was relocated to the fixed footer's center slot
            on 29-Jun-2026 — it's the primary post-dispatch action and was
            hiding below the items grid here. See RequestSummary actionSlot. */}
      </Box>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this request?"
        message={`This will cancel ${request.code}. You'll need to create a new request if you change your mind.`}
        confirmLabel="Cancel Request"
        cancelLabel="Keep it"
        onConfirm={handleCancel}
        onCancel={() => setCancelOpen(false)}
      />
      <ConfirmDialog
        open={receiveOpen}
        title="Confirm goods received?"
        message={`Mark ${request.code} as received. Only do this after you've physically received the dispatched items.`}
        confirmLabel="Yes, mark Received"
        cancelLabel="Not yet"
        onConfirm={handleReceive}
        onCancel={() => setReceiveOpen(false)}
      />
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
