import { Fragment, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, Pencil, Printer } from 'lucide-react'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Paper, Table, TableBody, TableCell, TableContainer, TableRow,
  TextField,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import { DispatchedCell } from '../../components/DispatchedCell'
import { RequestSummary } from '../../components/RequestSummary'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import {
  useStockRequest, useCancelStockRequest, useEditDispatchedQty,
} from '../../hooks/useStockRequests'
import type { RequestStatus, StockRequestItemDto } from '../../api/stock-requests/types'
import { ValidationError } from '../../api/errors'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'

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
  const [cancelConfirm, setCancelConfirm]   = useState(false)
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

  const flatErr = (e: unknown) =>
    e instanceof ValidationError ? e.flatten()
    : e instanceof Error ? e.message
    : null

  const handleCancel = async () => {
    try { await cancelMutation.mutateAsync(request.id) }
    finally { setCancelConfirm(false) }
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
                    <TableRow key={item.id} hover sx={{ bgcolor: rowBg }}>
                      <TableCell sx={{ pl: 3, py: 1.25 }}>
                        <Box sx={{ fontWeight: 600, fontSize: 14 }}>{item.productName}</Box>
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
    // pb leaves room for the fixed summary bar at the bottom + extra
    // breathing space above it so action buttons don't sit flush against
    // the footer (19-Jun-2026, client #14).
    <Box sx={{ pb: 16 }}>
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
      </Box>

      {/* Legacy: historical rows from before approval-step removal may still
          carry a rejection reason; show it if present. */}
      {request.status === 'Rejected' && request.rejectionReason && (
        <Alert severity="error" sx={{ mb: 2 }}>
          <strong>Rejected:</strong> {request.rejectionReason}
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

      {/* Items — CSS column-count masonry; cards auto-balanced. */}
      <Box
        sx={{
          columnCount: { xs: 1, md: 2 },
          columnGap: 2,
          // mb so action buttons / notes don't collapse flush against the
          // items grid (the inline Summary that used to sit here was moved
          // to a fixed footer 19-Jun-2026; this restores the visual gap).
          mb: 3,
          '& > *': { breakInside: 'avoid', display: 'block' },
        }}
      >
        {grouped.map(cg => renderCatGroup(cg))}
      </Box>

      {/* Fixed summary bar — same shape as the New Stock Request cart bar.
          19-Jun-2026 (client #14). */}
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

      {request.notes && (
        <Paper elevation={0} sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: '#FFF8DC', border: '1px dashed #1F1F1F' }}>
          <Box sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', mb: 0.5 }}>Shop's Notes</Box>
          <Box sx={{ fontSize: 14, color: '#1F1F1F', whiteSpace: 'pre-wrap' }}>{request.notes}</Box>
        </Paper>
      )}

      {[flatErr(cancelMutation.error), flatErr(editQtyMutation.error)]
        .filter(Boolean)
        .map((m, i) => <Alert key={i} severity="error" sx={{ mb: 1, whiteSpace: 'pre-line' }}>{m}</Alert>)}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap' }}>
        {canEdit && (
          <Button
            variant="outlined"
            startIcon={<Pencil className="w-4 h-4" />}
            onClick={() => navigate(`/admin/requests/${request.id}/edit`)}
            sx={{
              textTransform: 'none', fontWeight: 600,
              borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFF8E1',
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
            onClick={() => setCancelConfirm(true)}
            disabled={cancelMutation.isPending}
            sx={{
              textTransform: 'none', fontWeight: 600,
              borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFF8E1',
              '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
            }}
          >
            Cancel Request
          </Button>
        )}
      </Box>

      <ConfirmDialog
        open={cancelConfirm}
        title="Cancel this request?"
        message={`This will cancel ${request.code}. The shop must create a new request if needed.`}
        confirmLabel="Cancel Request"
        cancelLabel="Keep it"
        onConfirm={handleCancel}
        onCancel={() => setCancelConfirm(false)}
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
