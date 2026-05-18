import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, PackageCheck, Clock, ShieldX, Edit2, Printer } from 'lucide-react'
import {
  Alert, Box, Button, Chip, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import { DispatchedCell } from '../../components/DispatchedCell'
import { RequestSummary } from '../../components/RequestSummary'
import { formatINR } from '../../utils/format'
import {
  useStockRequest, useCancelStockRequest, useReceiveStockRequest,
} from '../../hooks/useStockRequests'
import type { RequestStatus } from '../../api/stock-requests/types'
import { ValidationError } from '../../api/errors'

const STATUS_COLOR: Record<RequestStatus, 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
  Pending:    'warning',
  Approved:   'info',
  Rejected:   'error',
  Dispatched: 'primary',
  Received:   'success',
  Cancelled:  'default',
}

const fmtIst = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '—'

export default function ShopRequestDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: request, isLoading, error } = useStockRequest(id)
  const cancelMutation  = useCancelStockRequest()
  const receiveMutation = useReceiveStockRequest()
  const [cancelOpen, setCancelOpen]   = useState(false)
  const [receiveOpen, setReceiveOpen] = useState(false)

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

  const canEdit    = request.status === 'Pending' && inEditWindow
  const canCancel  = (request.status === 'Pending' || request.status === 'Approved') && inEditWindow
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
            <BackButton onClick={() => navigate('/shop/requests')} />
          </Box>
        }
      />

      {/* Status & countdown row */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2, alignItems: 'center' }}>
        <Chip
          label={request.status}
          color={STATUS_COLOR[request.status]}
          variant={request.status === 'Received' ? 'filled' : 'outlined'}
          size="small"
          sx={{ fontWeight: 700 }}
        />
        {request.status === 'Pending' && (
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

      {/* Items table */}
      <Paper elevation={0} sx={{ mb: 2, borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFFFFF', overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FCD835' }}>
                <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11 }}>Product</TableCell>
                <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, width: 100 }} align="right">Weight</TableCell>
                <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, width: 90 }} align="right">Requested</TableCell>
                <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, width: 100 }} align="right">Dispatched</TableCell>
                <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, width: 110 }} align="right">Unit Price</TableCell>
                <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, width: 120 }} align="right">Subtotal</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(request.items ?? []).map(item => {
                // Subtotal reflects what's actually counted: before dispatch
                // that's the requested qty, after dispatch it's the dispatched qty.
                // Without this the column shows "₹65" even when only 2 of 5 shipped.
                const effectiveQty = item.dispatchedQty ?? item.requestedQty
                const effectiveSubtotal = effectiveQty * item.unitPrice
                const short = item.dispatchedQty != null && item.dispatchedQty < item.requestedQty
                return (
                  <TableRow key={item.id} hover>
                    <TableCell>
                      <Box sx={{ fontWeight: 600 }}>{item.productCode} — {item.productName}</Box>
                    </TableCell>
                    <TableCell align="right">
                      {item.weightValue != null
                        ? `${item.weightValue} ${item.weightUnit ?? ''}`.trim()
                        : <span className="text-[#1F1F1F]/40">—</span>}
                    </TableCell>
                    <TableCell align="right">{item.requestedQty}</TableCell>
                    <TableCell align="right">
                      <DispatchedCell qty={item.dispatchedQty} requested={item.requestedQty} />
                    </TableCell>
                    <TableCell align="right">{formatINR(item.unitPrice)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, color: short ? '#C62828' : '#1F1F1F' }}>
                      {formatINR(effectiveSubtotal)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Summary panel — overall totals broken out for clarity. */}
      <Box sx={{ mb: 2 }}>
        <RequestSummary request={request} />
      </Box>

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
