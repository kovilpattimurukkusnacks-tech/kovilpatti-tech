import { Fragment, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, Pencil, Printer } from 'lucide-react'
import {
  Alert, Box, Button, Chip, Paper, Table, TableBody, TableCell, TableContainer,
  TableRow,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import { DispatchedCell } from '../../components/DispatchedCell'
import { RequestSummary } from '../../components/RequestSummary'
import { formatINR } from '../../utils/format'
import { useStockRequest, useCancelStockRequest } from '../../hooks/useStockRequests'
import type { RequestStatus } from '../../api/stock-requests/types'
import { ValidationError } from '../../api/errors'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'

const STATUS_COLOR: Record<RequestStatus, 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
  // 'Draft' is filtered out of admin lists/detail endpoints by the BE, so
  // this branch shouldn't render in practice — the value is here to keep
  // the type system happy if a Draft ever leaks through.
  Draft: 'default',
  Pending: 'warning', Approved: 'info', Rejected: 'error',
  Dispatched: 'primary', Received: 'success', Cancelled: 'default',
}

const fmtIst = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '—'

export default function AdminRequestDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: request, isLoading, error } = useStockRequest(id)
  const cancelMutation  = useCancelStockRequest()
  const [cancelConfirm, setCancelConfirm]   = useState(false)

  // Card-per-category grouping. Computed unconditionally so hooks order stays
  // stable across loading / error renders.
  const grouped = useMemo(
    () => groupByCategoryWeight(
      request?.items ?? [],
      it => ({ category: it.categoryName, weightValue: it.weightValue, weightUnit: it.weightUnit }),
    ),
    [request?.items],
  )

  if (isLoading) return <Box><PageHeader title="Loading…" subtitle="" /></Box>
  if (error || !request) {
    return (
      <Box>
        <PageHeader title="Request not found" subtitle="" action={<BackButton onClick={() => navigate('/admin/requests')} />} />
        <Alert severity="error">{error instanceof Error ? error.message : 'Could not load request.'}</Alert>
      </Box>
    )
  }

  // Approval step removed from the workflow — Pending requests go straight to
  // inventory for dispatch. Admin keeps Edit Items + Cancel.
  // Items can be amended right up until the inventory dispatches.
  const canEdit   = request.status === 'Pending' || request.status === 'Approved'
  const canCancel = ['Pending', 'Approved'].includes(request.status)

  const flatErr = (e: unknown) =>
    e instanceof ValidationError ? e.flatten()
    : e instanceof Error ? e.message
    : null

  const handleCancel = async () => {
    try { await cancelMutation.mutateAsync(request.id) }
    finally { setCancelConfirm(false) }
  }

  return (
    <Box sx={{ pb: 4 }}>
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
                borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFFFFF',
                '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
              }}
            >
              Print
            </Button>
            <BackButton onClick={() => navigate('/admin/requests')} />
          </Box>
        }
      />

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2, alignItems: 'center' }}>
        <Chip
          label={request.status}
          color={STATUS_COLOR[request.status]}
          variant={request.status === 'Received' ? 'filled' : 'outlined'}
          size="small"
          sx={{ fontWeight: 700 }}
        />
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
          <TimelineItem label="Submitted"  value={fmtIst(request.submittedAt)}  by={request.submittedByName}  done />
          <TimelineItem label="Dispatched" value={fmtIst(request.dispatchedAt)} by={request.dispatchedByName} done={!!request.dispatchedAt} />
          <TimelineItem
            label={request.status === 'Cancelled' ? 'Cancelled' : request.status === 'Rejected' ? 'Rejected' : 'Received'}
            value={fmtIst(
              request.status === 'Cancelled' ? request.cancelledAt :
              request.status === 'Rejected'  ? null :
              request.receivedAt
            )}
            by={request.status === 'Received' ? request.receivedByName : null}
            done={['Received', 'Cancelled', 'Rejected'].includes(request.status)}
          />
        </Box>
      </Paper>

      {/* Items — one bordered card per category. Yellow header strip at the
          top of each card with the category name; inside, weight sub-headings
          and product rows. Same pattern across all request-detail screens. */}
      {grouped.map(catGroup => (
        <Paper
          key={catGroup.category}
          elevation={0}
          sx={{ mb: 2, borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFFFFF', overflow: 'hidden' }}
        >
          <Box
            sx={{
              bgcolor: '#FCD835',
              borderBottom: '2px solid #1F1F1F',
              px: 2,
              py: 1.25,
              fontWeight: 700,
              fontSize: 14,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
              color: '#1F1F1F',
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
                          bgcolor: '#FFFFFF',
                          pl: 2,
                          pt: wIdx === 0 ? 1.5 : 2.5,
                          pb: 0.5,
                          fontWeight: 700,
                          fontSize: 10,
                          textTransform: 'uppercase',
                          letterSpacing: 1.4,
                          color: '#1F1F1F66',
                          borderBottom: '1px solid rgba(31,31,31,0.08)',
                        }}
                      >
                        {wg.label}
                      </TableCell>
                    </TableRow>
                    {wg.items.map(item => {
                      // Subtotal reflects effective qty × price. Post-dispatch this is
                      // dispatched_qty; pre-dispatch (or never dispatched) it falls back
                      // to requested_qty so the column is meaningful in every state.
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
      ))}

      {/* Summary panel — overall totals broken out for clarity. */}
      <Box sx={{ mb: 2 }}>
        <RequestSummary request={request} />
      </Box>

      {request.notes && (
        <Paper elevation={0} sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: '#FFF8DC', border: '1px dashed #1F1F1F' }}>
          <Box sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', mb: 0.5 }}>Shop's Notes</Box>
          <Box sx={{ fontSize: 14, color: '#1F1F1F', whiteSpace: 'pre-wrap' }}>{request.notes}</Box>
        </Paper>
      )}

      {[flatErr(cancelMutation.error)]
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

      <ConfirmDialog
        open={cancelConfirm}
        title="Cancel this request?"
        message={`This will cancel ${request.code}. The shop must create a new request if needed.`}
        confirmLabel="Cancel Request"
        cancelLabel="Keep it"
        onConfirm={handleCancel}
        onCancel={() => setCancelConfirm(false)}
      />
    </Box>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outlined" startIcon={<ArrowLeft className="w-4 h-4" />} onClick={onClick}
      sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFFFFF', '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' } }}>
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
