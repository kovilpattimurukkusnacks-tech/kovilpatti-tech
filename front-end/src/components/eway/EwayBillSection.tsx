import { useState } from 'react'
import {
  Alert, Box, Button, Chip, IconButton, Paper, Table, TableBody, TableCell,
  TableHead, TableRow, Tooltip,
} from '@mui/material'
import { ExternalLink, FileText, Plus, XCircle } from 'lucide-react'
import { formatINR } from '../../utils/format'
import { useCancelEwayBill, useEwayBillsForPurchase } from '../../hooks/useEwayBills'
import type { EwayBillDto, EwayBillStatus } from '../../api/eway-bills/types'
import EwayBillDialog from './EwayBillDialog'

type Props = {
  /** Parent vendor_purchases id. Required — the section is scoped under it. */
  purchaseId: string
  /** True when the parent is Received; hides Add / Cancel buttons. */
  locked: boolean
  /** Purchase-level context to prefill the dialog (invoice number/date/amount).
   *  Optional — the dialog works without them, they just save keystrokes. */
  invoiceNumber?: string
  invoiceDate?: string
  invoiceAmount?: number
  /** True when the gate would fire (interstate + threshold matched). Drives
   *  the muted "not required" note when false. */
  gateActive: boolean
}

const STATUS_TONE: Record<EwayBillStatus, { fg: string; bg: string; border: string }> = {
  Draft:     { fg: '#8B6B00', bg: '#FFF3CD', border: '#E0A800' },
  Generated: { fg: '#2E7D32', bg: '#EAF7EE', border: '#2E7D32' },
  Cancelled: { fg: '#7A2A2A', bg: '#FFEBEE', border: '#B22222' },
  Expired:   { fg: '#7A2A2A', bg: '#FFEBEE', border: '#B22222' },
}

// Cream — matches the other section cards on this page and the
// FilterBar/dropdown cream palette used across the app.
const PANEL_BG = '#FFFBE6'

export default function EwayBillSection({
  purchaseId, locked, invoiceNumber, invoiceDate, invoiceAmount, gateActive,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const listQuery = useEwayBillsForPurchase(purchaseId)
  const cancel = useCancelEwayBill(purchaseId)

  const rows: EwayBillDto[] = listQuery.data ?? []
  const activeGenerated = rows.some(r => r.status === 'Generated')

  const handleCancel = async (id: string) => {
    if (!window.confirm('Cancel this e-way bill? The row stays for audit; status flips to Cancelled.')) return
    try {
      await cancel.mutateAsync({ id })
    } catch {
      // Errors surface via listQuery / mutation state; noop here.
    }
  }

  return (
    <Paper
      sx={{
        p: 3, mb: 3, borderRadius: 2.5,
        border: '2px solid #1F1F1F',
        boxShadow: '4px 4px 0 0 #FCD835',
        bgcolor: PANEL_BG,
      }}
      elevation={0}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
        <FileText className="w-4 h-4" />
        <Box sx={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 14, letterSpacing: '0.03em' }}>
          E-way Bill (Inbound)
        </Box>
        {gateActive && !activeGenerated && (
          <Chip
            label="Required before Receive"
            size="small"
            sx={{
              ml: 1, fontWeight: 700,
              bgcolor: '#FFF3CD', color: '#8A6200',
              border: '1px solid #E0A800',
            }}
          />
        )}
        {activeGenerated && (
          <Chip
            label="Attached"
            size="small"
            sx={{
              ml: 1, fontWeight: 700,
              bgcolor: '#EAF7EE', color: '#2E7D32',
              border: '1px solid #2E7D32',
            }}
          />
        )}
        <Box sx={{ flexGrow: 1 }} />
        {!locked && (
          <Button
            startIcon={<Plus className="w-4 h-4" />}
            variant="outlined"
            size="small"
            onClick={() => setDialogOpen(true)}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Add e-way bill
          </Button>
        )}
      </Box>

      {!gateActive && (
        <Alert severity="info" sx={{ mb: 2 }}>
          This purchase is below the inbound e-way threshold — a bill isn't required.
          You can still record one for audit if the portal issued one.
        </Alert>
      )}

      {listQuery.isLoading ? (
        <Box sx={{ opacity: 0.6, fontSize: 14 }}>Loading e-way bills…</Box>
      ) : rows.length === 0 ? (
        <Box sx={{ opacity: 0.6, fontSize: 14, py: 2, textAlign: 'center' }}>
          No e-way bills recorded yet.
        </Box>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>E-way #</TableCell>
              <TableCell>Vehicle</TableCell>
              <TableCell align="right">Distance</TableCell>
              <TableCell align="right">Total</TableCell>
              <TableCell>Valid until</TableCell>
              <TableCell>Status</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(r => {
              const tone = STATUS_TONE[r.status]
              return (
                <TableRow key={r.id}>
                  <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.ewayNumber}</TableCell>
                  <TableCell>{r.vehicleNumber ?? '—'}</TableCell>
                  <TableCell align="right">{r.distanceKm != null ? `${r.distanceKm} km` : '—'}</TableCell>
                  <TableCell align="right">{r.totalAmount != null ? formatINR(r.totalAmount) : '—'}</TableCell>
                  <TableCell>{r.validUntil ? new Date(r.validUntil).toLocaleDateString('en-IN') : '—'}</TableCell>
                  <TableCell>
                    <Chip
                      label={r.status}
                      size="small"
                      sx={{ fontWeight: 700, bgcolor: tone.bg, color: tone.fg, border: `1px solid ${tone.border}` }}
                    />
                  </TableCell>
                  {/* Actions cell always renders — PDF link stays accessible
                      even on Received (locked) purchases for audit lookup;
                      Cancel is gated on !locked + Generated status. */}
                  <TableCell align="right">
                    {r.attachmentUrl && (
                      <Tooltip title="Open portal PDF in new tab">
                        <IconButton
                          size="small"
                          component="a"
                          href={r.attachmentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {!locked && r.status === 'Generated' && (
                      <Tooltip title="Cancel this e-way bill">
                        <span>
                          <IconButton size="small" color="error" onClick={() => handleCancel(r.id)}>
                            <XCircle className="w-4 h-4" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <EwayBillDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        purchaseId={purchaseId}
        prefill={{ invoiceNumber, invoiceDate, invoiceAmount }}
      />
    </Paper>
  )
}
