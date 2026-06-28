import { Fragment, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, PackageCheck, Clock, ShieldX, Edit2, Printer } from 'lucide-react'
import {
  Alert, Box, Button, Chip, Paper, Table, TableBody, TableCell, TableContainer,
  TableRow,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import { DispatchedCell } from '../../components/DispatchedCell'
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
  const canCancel  = (request.status === 'Pending' || request.status === 'Approved') && effectiveInWindow
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
                  return (
                    <TableRow key={item.id} hover>
                      <TableCell sx={{ pl: 3, py: 1.25 }}>
                        <Box sx={{ fontWeight: 600, fontSize: 14 }}>{item.productName}</Box>
                      </TableCell>
                      <TableCell align="right" sx={{ py: 1.25, width: 90 }}>{item.requestedQty}</TableCell>
                      <TableCell align="right" sx={{ py: 1.25, width: 100 }}>
                        <DispatchedCell qty={item.dispatchedQty} requested={item.requestedQty} />
                      </TableCell>
                      <TableCell align="right" sx={{ py: 1.25, width: 110 }}>{formatINR(item.unitPrice)}</TableCell>
                      <TableCell align="right" sx={{ py: 1.25, width: 120, fontWeight: 600, color: short ? '#C62828' : '#1F1F1F' }}>
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
                borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFFFFF',
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

      {/* Items — CSS column-count masonry. Browser distributes cards across
          two columns (1 on xs) to even out column height. break-inside on
          each card stops a category from splitting across the gutter. */}
      <Box
        sx={{
          columnCount: { xs: 1, md: 2 },
          columnGap: 2,
          // mb gives Notes / Errors / Actions room to breathe under the
          // items grid. Previously the inline Summary card provided this
          // gap; once that became a fixed footer (out of flow), buttons
          // collapsed flush against items — restored explicitly here.
          mb: 3,
          '& > *': { breakInside: 'avoid', display: 'block' },
        }}
      >
        {grouped.map(cg => renderCatGroup(cg))}
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
        <RequestSummary request={request} variant="footer" />
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
              borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFFFFF',
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
        {canReceive && (
          <Button
            variant="contained"
            startIcon={<PackageCheck className="w-4 h-4" />}
            onClick={() => setReceiveOpen(true)}
            disabled={receiveMutation.isPending}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            Confirm Received
          </Button>
        )}
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
        borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFFFFF',
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
