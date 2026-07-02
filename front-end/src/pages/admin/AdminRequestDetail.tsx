import { Fragment, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, Pencil, Printer, Undo2 } from 'lucide-react'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import { DispatchedCell } from '../../components/DispatchedCell'
import { InvBadge } from '../../components/InvBadge'
import { RequestSummary } from '../../components/RequestSummary'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import {
  useStockRequest, useCancelStockRequest, useEditDispatchedQty,
  useRevokeStockRequest,
} from '../../hooks/useStockRequests'
import type { RequestStatus, StockRequestItemDto } from '../../api/stock-requests/types'
import { ValidationError } from '../../api/errors'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import { buildRootLookup, sortRootCategoryNames } from '../../utils/rootCategoryPriority'
import { useCategories } from '../../hooks/useCategories'

const STATUS_COLOR: Record<RequestStatus, 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
  // 'Draft' is filtered out of admin lists/detail endpoints by the BE, so
  // this branch shouldn't render in practice — the value is here to keep
  // the type system happy if a Draft ever leaks through.
  Draft: 'default',
  Pending: 'warning', Approved: 'info', Rejected: 'error',
  Dispatched: 'primary', Received: 'success', Cancelled: 'default',
  // Returns' terminal state — green-success once goods are back at godown.
  Accepted: 'success',
}

export default function AdminRequestDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  // location.key === 'default' means this tab landed directly on the detail
  // route (refresh / bookmark / paste-url). Anything else means the user
  // navigated in from another route within the app — so navigate(-1) is
  // safe and preserves the list page's filter URL. Fallback to the bare
  // list URL when there's no app history to go back to.
  const location = useLocation()
  const backToList = () => {
    if (location.key !== 'default') navigate(-1)
    else navigate('/admin/requests')
  }
  const { data: request, isLoading, error } = useStockRequest(id)
  const cancelMutation  = useCancelStockRequest()
  const editQtyMutation = useEditDispatchedQty()
  const revokeMutation  = useRevokeStockRequest()
  const [cancelConfirm, setCancelConfirm]   = useState(false)
  const [revokeConfirm, setRevokeConfirm]   = useState(false)
  // Post-completion qty edit dialog state. `editingItem` is the row being
  // edited (null = dialog closed). The qty field is a string so we can
  // distinguish "" (untouched / cleared) from "0" (valid edit to zero).
  const [editingItem,    setEditingItem]    = useState<StockRequestItemDto | null>(null)
  const [editingQtyText, setEditingQtyText] = useState<string>('')
  const [editingReason,  setEditingReason]  = useState<string>('')

  // Card-per-category grouping. Computed unconditionally so hooks order stays
  // stable across loading / error renders.
  const grouped = useMemo(
    () => groupByCategoryWeight(
      request?.items ?? [],
      it => ({ category: it.categoryName, weightValue: it.weightValue, weightUnit: it.weightUnit }),
    ),
    [request?.items],
  )

  // Two-level grouping: outer = root category (1 KG Snacks, Pickle/Thokku/Podi…)
  // in hard-coded priority order; inner = leaf-cat cards (existing layout).
  // Mirrors ShopRequestDetail / InventoryRequestDetail so every detail page
  // shows the same top-level hierarchy (30-Jun-2026 client req).
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

  // Layout note: cards flow into a CSS `column-count` container below — the
  // browser auto-balances across 2 columns (1 on mobile). break-inside keeps
  // each card intact, so categories never split across the gutter.

  if (isLoading) return <Box><PageHeader title="Loading…" subtitle="" /></Box>
  if (error || !request) {
    return (
      <Box>
        <PageHeader title="Request not found" subtitle="" action={<BackButton onClick={backToList} />} />
        <Alert severity="error">{error instanceof Error ? error.message : 'Could not load request.'}</Alert>
      </Box>
    )
  }

  // Approval step removed from the workflow — Pending requests go straight to
  // inventory for dispatch. Admin keeps Edit Items + Cancel.
  // Items can be amended right up until the inventory dispatches.
  const canEdit   = request.status === 'Pending' || request.status === 'Approved'
  const canCancel = ['Pending', 'Approved'].includes(request.status)
  // Admin-only post-completion qty correction. Available on terminal states
  // (Received Orders + Accepted Returns). Phase 3 accounts uses the audit
  // trail this writes to post reconciliation entries.
  const canEditQty = request.status === 'Received' || request.status === 'Accepted'
  // Revoke — undo an accidental Approve, Reject, or Cancel and flip back
  // to Pending. Applies to both Orders and Returns for Rejected /
  // Cancelled (client req 01-Jul-2026: godown rejecting a Return by
  // mistake needs the same recovery path). Approved is Order-only —
  // Returns have no Approved intermediate state.
  const isReturn      = request.requestType === 'Return'
  const canRevoke     =
    (request.status === 'Approved' && !isReturn) ||
    request.status === 'Rejected' ||
    request.status === 'Cancelled'

  const flatErr = (e: unknown) =>
    e instanceof ValidationError ? e.flatten()
    : e instanceof Error ? e.message
    : null

  const handleCancel = async () => {
    try { await cancelMutation.mutateAsync(request.id) }
    finally { setCancelConfirm(false) }
  }

  const handleRevoke = async () => {
    try { await revokeMutation.mutateAsync(request.id) }
    finally { setRevokeConfirm(false) }
  }

  const openQtyEdit = (item: StockRequestItemDto) => {
    setEditingItem(item)
    // Pre-fill with the current dispatched value (or empty when null) so the
    // admin starts from the existing state, not a blank cell.
    setEditingQtyText(item.dispatchedQty == null ? '' : String(item.dispatchedQty))
    setEditingReason('')
    editQtyMutation.reset()
  }

  const closeQtyEdit = () => {
    setEditingItem(null)
    setEditingQtyText('')
    setEditingReason('')
    editQtyMutation.reset()
  }

  const handleSaveQty = async () => {
    if (!editingItem) return
    const trimmed = editingQtyText.trim()
    // "" → null (clear the dispatched value). Otherwise must parse to int.
    const parsed  = trimmed === '' ? null : Number(trimmed)
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0)) return
    await editQtyMutation.mutateAsync({
      requestId: request.id,
      itemId:    editingItem.id,
      req: { newQty: parsed, reason: editingReason.trim() || undefined },
    })
    closeQtyEdit()
  }

  // Card renderer for one category-group. Same JSX serves both columns of
  // the 2-col grid below. Closes over canEditQty / openQtyEdit / formatINR
  // / DispatchedCell / Pencil from the outer scope.
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
          {/* Column headers row (30-Jun-2026 client req). */}
          <TableHead>
            <TableRow sx={{ bgcolor: '#FFFBE6' }}>
              <TableCell sx={{ py: 0.75, pl: 3, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', borderBottom: '1px solid rgba(31,31,31,0.15)' }}>Product</TableCell>
              <TableCell align="right" sx={{ py: 0.75, width: 90,  fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', borderBottom: '1px solid rgba(31,31,31,0.15)' }}>Req Qty</TableCell>
              <TableCell align="right" sx={{ py: 0.75, width: 100, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', borderBottom: '1px solid rgba(31,31,31,0.15)' }}>Disp Qty</TableCell>
              <TableCell align="right" sx={{ py: 0.75, width: 110, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', borderBottom: '1px solid rgba(31,31,31,0.15)' }}>MRP</TableCell>
              <TableCell align="right" sx={{ py: 0.75, width: 120, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', borderBottom: '1px solid rgba(31,31,31,0.15)' }}>Net Amt</TableCell>
              {canEditQty && (
                <TableCell align="center" sx={{ py: 0.75, width: 48, borderBottom: '1px solid rgba(31,31,31,0.15)' }} />
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {catGroup.weightGroups.map((wg, wIdx) => (
              <Fragment key={`${catGroup.category}__${wg.label}`}>
                <TableRow>
                  <TableCell
                    colSpan={canEditQty ? 6 : 5}
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
                  const effectiveQty = item.dispatchedQty ?? item.requestedQty
                  const effectiveSubtotal = effectiveQty * item.unitPrice
                  const short = item.dispatchedQty != null && item.dispatchedQty < item.requestedQty
                  // Mirrors ShopRequestDetail — over flag + row tint so the
                  // shop/admin/inventory pages tell the same story when an
                  // order ended up under or over the original request.
                  const over  = item.dispatchedQty != null && item.dispatchedQty > item.requestedQty
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
                      {canEditQty && (
                        <TableCell align="center" sx={{ py: 1.25, width: 48 }}>
                          <IconButton
                            size="small"
                            aria-label="Edit dispatched qty"
                            onClick={() => openQtyEdit(item)}
                          >
                            <Pencil className="w-4 h-4" />
                          </IconButton>
                        </TableCell>
                      )}
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
    // pb leaves room for the fixed footer at the bottom. Footer stacks
    // an action row (buttons) on top of the summary strip, so it's
    // taller now — bumped from pb:16 to pb:22 (01-Jul-2026).
    <Box sx={{ pb: 22 }}>
      <PageHeader
        title={request.code}
        subtitle={`${request.shopCode} ${request.shopName} → ${request.inventoryCode} ${request.inventoryName}`}
        action={
          <Box sx={{ display: 'flex', gap: 1 }}>
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
            <BackButton onClick={backToList} />
          </Box>
        }
      />

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2, alignItems: 'center' }}>
        <Chip
          label={request.status}
          color={STATUS_COLOR[request.status]}
          variant={request.status === 'Received' || request.status === 'Accepted' ? 'filled' : 'outlined'}
          size="small"
          sx={{ fontWeight: 700 }}
        />
        {/* Red "Return" pill — sits next to the status chip so admin can
            see at a glance that this is a Return, regardless of where it
            is in the flow. */}
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
        {/* Dispatch draft indicator — same treatment as the list-row +
            inventory-detail chip so admin can spot WIP dispatches at a
            glance while reviewing the request. */}
        {(request.items ?? []).some(it => it.draftDispatchedQty != null) && (
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
      </Box>

      {/* Rejected banner — surfaces the rejection reason (when present) and
          exposes the Undo Rejection action right here at the top so admin
          sees the corrective path immediately, without scrolling to the
          action row (30-Jun-2026 client req). */}
      {request.status === 'Rejected' && (
        <Alert
          severity="error"
          sx={{ mb: 2, '& .MuiAlert-action': { pt: 0, alignItems: 'center' } }}
          action={canRevoke ? (
            <Button
              variant="contained"
              size="small"
              startIcon={<Undo2 className="w-3.5 h-3.5" />}
              onClick={() => setRevokeConfirm(true)}
              disabled={revokeMutation.isPending}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                bgcolor: '#1F1F1F',
                color: '#FFFFFF',
                '&:hover': { bgcolor: '#0A0A0A' },
              }}
            >
              Undo Rejection
            </Button>
          ) : undefined}
        >
          <strong>Rejected</strong>
          {request.rejectionReason ? `: ${request.rejectionReason}` : ''}
        </Alert>
      )}

      {/* Cancelled banner — same UX shape as Rejected. Warning colour (not
          error) because a cancel isn't a failure, just the shop backing
          out. Undo Cancel restores the row to Pending so the shop can
          continue where they left off. (01-Jul-2026 client req.) */}
      {request.status === 'Cancelled' && (
        <Alert
          severity="warning"
          sx={{ mb: 2, '& .MuiAlert-action': { pt: 0, alignItems: 'center' } }}
          action={canRevoke ? (
            <Button
              variant="contained"
              size="small"
              startIcon={<Undo2 className="w-3.5 h-3.5" />}
              onClick={() => setRevokeConfirm(true)}
              disabled={revokeMutation.isPending}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                bgcolor: '#1F1F1F',
                color: '#FFFFFF',
                '&:hover': { bgcolor: '#0A0A0A' },
              }}
            >
              Undo Cancel
            </Button>
          ) : undefined}
        >
          <strong>Cancelled</strong>
          {request.cancelledAt ? ` on ${formatIstDateTime(request.cancelledAt)}` : ''}
        </Alert>
      )}

      <Paper elevation={0} sx={{ p: 2, mb: 2, borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFFFFF' }}>
        {/* Approval step removed from the workflow. Timeline is now Submitted →
            Dispatched → Received. (Legacy approvedAt/approvedByName values on
            historical rows remain in the DTO but aren't surfaced anymore.) */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2 }}>
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

      {/* Items — cream banner strip per root (mirrors ShopRequestDetail).
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

      {request.notes && (
        <Paper elevation={0} sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: '#FFF8DC', border: '1px dashed #1F1F1F' }}>
          <Box sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', mb: 0.5 }}>Shop's Notes</Box>
          <Box sx={{ fontSize: 14, color: '#1F1F1F', whiteSpace: 'pre-wrap' }}>{request.notes}</Box>
        </Paper>
      )}

      {[flatErr(cancelMutation.error), flatErr(editQtyMutation.error), flatErr(revokeMutation.error)]
        .filter(Boolean)
        .map((m, i) => <Alert key={i} severity="error" sx={{ mb: 1, whiteSpace: 'pre-line' }}>{m}</Alert>)}

      {/* Fixed footer bar (01-Jul-2026 client req: action buttons no longer
          require scrolling). Stacks:
            • top row  — Edit / Revoke / Cancel action buttons (right-aligned)
            • bottom row — summary counts + amounts (as before)
          Rendered as one Paper pinned to the viewport bottom. Actions
          row hidden when no action applies (nothing to show → skip it). */}
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
        {(canEdit || (canRevoke && request.status === 'Approved') || canCancel) && (
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
                startIcon={<Pencil className="w-4 h-4" />}
                onClick={() => navigate(`/admin/requests/${request.id}/edit`)}
                sx={{
                  textTransform: 'none', fontWeight: 600,
                  borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFFFFF',
                  '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
                }}
              >
                Edit Items
              </Button>
            )}
            {/* Sticky-footer Revoke only for APPROVED. Rejected /
                Cancelled variants live in their top-of-page alerts
                (more discoverable there). */}
            {canRevoke && request.status === 'Approved' && (
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
                Revoke Approval
              </Button>
            )}
            {canCancel && (
              <Button
                variant="outlined"
                startIcon={<Ban className="w-4 h-4" />}
                onClick={() => setCancelConfirm(true)}
                disabled={cancelMutation.isPending}
                sx={{
                  textTransform: 'none', fontWeight: 600,
                  borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFFFFF',
                  '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
                }}
              >
                Cancel Request
              </Button>
            )}
          </Box>
        )}
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 1.5 }}>
          <RequestSummary request={request} variant="footer" />
        </Box>
      </Paper>

      <ConfirmDialog
        open={cancelConfirm}
        title="Cancel this request?"
        message={`This will cancel ${request.code}. The shop must create a new request if needed.`}
        confirmLabel="Cancel Request"
        cancelLabel="Keep it"
        onConfirm={handleCancel}
        onCancel={() => setCancelConfirm(false)}
      />

      <ConfirmDialog
        open={revokeConfirm}
        title={
          request.status === 'Rejected'  ? 'Undo this rejection?'
          : request.status === 'Cancelled' ? 'Undo this cancel?'
          : 'Revoke this approval?'
        }
        message={
          request.status === 'Rejected'
            ? `This sends ${request.code} back to Pending and clears the rejection reason. The shop will see it as a fresh request again and the inventory can approve or reject it once more.`
            : request.status === 'Cancelled'
            ? `This sends ${request.code} back to Pending. The shop will be able to edit or submit the request again, and the inventory will see it in the Needs Action queue.`
            : `This sends ${request.code} back to Pending. The shop will be able to edit it again, and the inventory can approve or reject it once more before dispatch.`
        }
        confirmLabel={
          request.status === 'Rejected'  ? 'Yes, Undo Rejection'
          : request.status === 'Cancelled' ? 'Yes, Undo Cancel'
          : 'Yes, Revoke'
        }
        cancelLabel="Not yet"
        onConfirm={handleRevoke}
        onCancel={() => setRevokeConfirm(false)}
      />

      {/* Post-completion qty edit dialog. Opens when the admin clicks the
          pencil on any item row (only visible on Received/Accepted requests).
          Save writes an audit row via fn_request_item_edit_dispatched_qty. */}
      <Dialog open={!!editingItem} onClose={closeQtyEdit} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Edit dispatched qty</DialogTitle>
        <DialogContent>
          {editingItem && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
              <Box>
                <Box sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99' }}>
                  Product
                </Box>
                <Box sx={{ fontSize: 14, fontWeight: 600, color: '#1F1F1F' }}>
                  {editingItem.productName}
                </Box>
                <Box sx={{ fontSize: 12, color: '#1F1F1F99', mt: 0.5 }}>
                  Requested {editingItem.requestedQty}
                  {' · '}
                  Currently dispatched {editingItem.dispatchedQty ?? '—'}
                </Box>
              </Box>

              <TextField
                label="New qty"
                value={editingQtyText}
                onChange={e => {
                  // Digits only — empty string is a valid intent ("clear it").
                  const v = e.target.value
                  if (v === '' || /^\d+$/.test(v)) setEditingQtyText(v)
                }}
                onFocus={e => (e.target as HTMLInputElement).select()}
                placeholder="Leave blank to clear"
                inputMode="numeric"
                fullWidth
                size="small"
                autoFocus
              />

              <TextField
                label="Reason (optional)"
                value={editingReason}
                onChange={e => setEditingReason(e.target.value)}
                placeholder="e.g. counted wrong; one carton miscount"
                fullWidth
                size="small"
                multiline
                minRows={2}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={closeQtyEdit}
            disabled={editQtyMutation.isPending}
            sx={{ textTransform: 'none' }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveQty}
            disabled={
              editQtyMutation.isPending
              // No-op guard — disable Save when the qty hasn't actually changed.
              || (editingItem != null
                  && (editingQtyText.trim() === ''
                        ? editingItem.dispatchedQty == null
                        : Number(editingQtyText.trim()) === editingItem.dispatchedQty))
            }
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outlined" startIcon={<ArrowLeft className="w-4 h-4" />} onClick={onClick}
      sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFF8E1', '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' } }}>
      Back to list
    </Button>
  )
}

function TimelineItem({ label, value, by, done }: { label: string; value: string; by?: string | null; done: boolean }) {
  return (
    <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: done ? '#FFF8DC' : 'rgba(31,31,31,0.04)', border: '1px solid', borderColor: done ? '#FCD835' : 'rgba(31,31,31,0.1)' }}>
      <Box sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: done ? '#1F1F1F' : '#1F1F1F66' }}>{label}</Box>
      <Box sx={{ fontSize: 13, fontWeight: 600, color: done ? '#1F1F1F' : '#1F1F1F66' }}>{value}</Box>
      {done && by && (
        <Box sx={{ fontSize: 11, fontWeight: 500, color: '#1F1F1F99', mt: 0.25 }}>by {by}</Box>
      )}
    </Box>
  )
}
