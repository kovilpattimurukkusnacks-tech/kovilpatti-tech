import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem,
  TextField,
} from '@mui/material'
import { ValidationError } from '../../api/errors'
import { useRecordEwayBill } from '../../hooks/useEwayBills'
import type { EwayTransportMode } from '../../api/eway-bills/types'

type Props = {
  open: boolean
  onClose: () => void
  purchaseId: string
  prefill?: {
    invoiceNumber?: string
    invoiceDate?: string
    invoiceAmount?: number
  }
}

// Cream palette background — no white per Kovilpatti FE rule.
const DIALOG_BG = '#FFFBE6'
const TRANSPORT_MODES: EwayTransportMode[] = ['Road', 'Rail', 'Air', 'Ship']

function toNum(s: string): number | null {
  if (s == null || s.trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export default function EwayBillDialog({ open, onClose, purchaseId, prefill }: Props) {
  const record = useRecordEwayBill(purchaseId)

  const [ewayNumber, setEwayNumber] = useState('')
  const [generationDate, setGenerationDate] = useState('')
  const [documentNumber, setDocumentNumber] = useState('')
  const [documentDate, setDocumentDate] = useState('')
  const [validUntil, setValidUntil] = useState('')

  const [fromGstin, setFromGstin] = useState('')
  const [fromStateCode, setFromStateCode] = useState('')
  const [toGstin, setToGstin] = useState('')
  const [toStateCode, setToStateCode] = useState('33') // Tamil Nadu default — recipient

  const [transportMode, setTransportMode] = useState<EwayTransportMode | ''>('Road')
  const [distanceKm, setDistanceKm] = useState('')
  const [transporterName, setTransporterName] = useState('')
  const [vehicleNumber, setVehicleNumber] = useState('')

  const [taxableAmount, setTaxableAmount] = useState('')
  const [cgstAmount, setCgstAmount] = useState('')
  const [sgstAmount, setSgstAmount] = useState('')
  const [igstAmount, setIgstAmount] = useState('')
  const [totalAmount, setTotalAmount] = useState('')

  const [attachmentUrl, setAttachmentUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [localErr, setLocalErr] = useState<string | null>(null)

  // Prefill from parent purchase on open. Depend on `open` only — otherwise
  // the effect fires again mid-typing when the parent invoice amount is
  // typed live in AdminPurchaseNew. (See lessons: useEffect deps including
  // derived state cause overwrite of mid-typing values.)
  useEffect(() => {
    if (!open) return
    setEwayNumber('')
    setGenerationDate('')
    setDocumentNumber(prefill?.invoiceNumber ?? '')
    setDocumentDate(prefill?.invoiceDate?.slice(0, 10) ?? '')
    setValidUntil('')
    setFromGstin('')
    setFromStateCode('')
    setToGstin('')
    setToStateCode('33')
    setTransportMode('Road')
    setDistanceKm('')
    setTransporterName('')
    setVehicleNumber('')
    setTaxableAmount('')
    setCgstAmount('')
    setSgstAmount('')
    setIgstAmount('')
    setTotalAmount(prefill?.invoiceAmount != null ? String(prefill.invoiceAmount) : '')
    setAttachmentUrl('')
    setNotes('')
    setLocalErr(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleSubmit = async () => {
    setLocalErr(null)
    if (!ewayNumber.trim()) { setLocalErr('E-way number is required.'); return }

    // Client-side XOR guard so the user gets an immediate hint before the
    // BE round-trip. SP has chk_eway_bills_tax_exclusive as last resort.
    const cgst = toNum(cgstAmount)
    const sgst = toNum(sgstAmount)
    const igst = toNum(igstAmount)
    if ((igst ?? 0) > 0 && ((cgst ?? 0) > 0 || (sgst ?? 0) > 0)) {
      setLocalErr('Interstate purchases carry IGST only — clear CGST/SGST or IGST.')
      return
    }

    try {
      await record.mutateAsync({
        ewayNumber: ewayNumber.trim(),
        generationDate: generationDate ? new Date(generationDate).toISOString() : null,
        documentNumber: documentNumber.trim() || null,
        documentDate: documentDate || null,
        validUntil: validUntil ? new Date(validUntil).toISOString() : null,
        fromGstin: fromGstin.trim() || null,
        fromStateCode: fromStateCode.trim() || null,
        toGstin: toGstin.trim() || null,
        toStateCode: toStateCode.trim() || null,
        transportMode: transportMode || null,
        distanceKm: toNum(distanceKm),
        transporterName: transporterName.trim() || null,
        vehicleNumber: vehicleNumber.trim() || null,
        taxableAmount: toNum(taxableAmount),
        cgstAmount: cgst,
        sgstAmount: sgst,
        igstAmount: igst,
        totalAmount: toNum(totalAmount),
        attachmentUrl: attachmentUrl.trim() || null,
        notes: notes.trim() || null,
      })
      onClose()
    } catch {
      // Surfaces via submitError
    }
  }

  const submitError = record.error instanceof ValidationError
    ? record.error.flatten()
    : record.error instanceof Error ? record.error.message : null

  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => {
        // Kovilpatti rule: block backdrop + Escape dismissal.
        if (reason === 'backdropClick' || reason === 'escapeKeyDown') return
        onClose()
      }}
      fullWidth
      maxWidth="md"
      slotProps={{ paper: { sx: { bgcolor: DIALOG_BG } } }}
    >
      <DialogTitle sx={{ fontWeight: 700 }}>Add E-way Bill</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, pt: 1 }}>
          <TextField
            label="E-way Number *" size="small"
            value={ewayNumber}
            onChange={e => setEwayNumber(e.target.value)}
            inputMode="numeric"
          />
          <TextField
            label="Generation Date/Time" size="small"
            type="datetime-local"
            value={generationDate}
            onChange={e => setGenerationDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />

          <TextField
            label="Invoice / Document Number" size="small"
            value={documentNumber}
            onChange={e => setDocumentNumber(e.target.value)}
          />
          <TextField
            label="Document Date" size="small"
            type="date"
            value={documentDate}
            onChange={e => setDocumentDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />

          <TextField
            label="Valid Until" size="small"
            type="datetime-local"
            value={validUntil}
            onChange={e => setValidUntil(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Box />{/* filler cell — keeps grid alignment */}

          <TextField
            label="Vendor GSTIN (From)" size="small"
            value={fromGstin}
            onChange={e => setFromGstin(e.target.value.toUpperCase())}
            slotProps={{ htmlInput: { maxLength: 15 } }}
          />
          <TextField
            label="From State Code" size="small"
            value={fromStateCode}
            onChange={e => setFromStateCode(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 2 } }}
          />
          <TextField
            label="Our GSTIN (To)" size="small"
            value={toGstin}
            onChange={e => setToGstin(e.target.value.toUpperCase())}
            slotProps={{ htmlInput: { maxLength: 15 } }}
          />
          <TextField
            label="To State Code" size="small"
            value={toStateCode}
            onChange={e => setToStateCode(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 2 } }}
            helperText="Default 33 (Tamil Nadu)"
          />

          <TextField
            select label="Transport Mode" size="small"
            value={transportMode}
            onChange={e => setTransportMode(e.target.value as EwayTransportMode | '')}
          >
            <MenuItem value="">(not set)</MenuItem>
            {TRANSPORT_MODES.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
          </TextField>
          <TextField
            label="Distance (km)" size="small" type="number"
            value={distanceKm}
            onChange={e => setDistanceKm(e.target.value)}
          />

          <TextField
            label="Transporter Name" size="small"
            value={transporterName}
            onChange={e => setTransporterName(e.target.value)}
          />
          <TextField
            label="Vehicle Number" size="small"
            value={vehicleNumber}
            onChange={e => setVehicleNumber(e.target.value.toUpperCase())}
          />

          <TextField
            label="Taxable Amount (₹)" size="small" type="number"
            value={taxableAmount}
            onChange={e => setTaxableAmount(e.target.value)}
          />
          <TextField
            label="Total Amount (₹)" size="small" type="number"
            value={totalAmount}
            onChange={e => setTotalAmount(e.target.value)}
          />

          <TextField
            label="CGST (₹)" size="small" type="number"
            value={cgstAmount}
            onChange={e => setCgstAmount(e.target.value)}
            helperText="Leave blank for interstate"
          />
          <TextField
            label="SGST (₹)" size="small" type="number"
            value={sgstAmount}
            onChange={e => setSgstAmount(e.target.value)}
            helperText="Leave blank for interstate"
          />
          <TextField
            label="IGST (₹)" size="small" type="number"
            value={igstAmount}
            onChange={e => setIgstAmount(e.target.value)}
            helperText="Interstate: enter IGST only"
          />
          <TextField
            label="Portal PDF URL" size="small"
            value={attachmentUrl}
            onChange={e => setAttachmentUrl(e.target.value)}
          />

          <TextField
            label="Notes" size="small"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            multiline minRows={2}
            sx={{ gridColumn: { sm: '1 / -1' } }}
          />
        </Box>

        {localErr && <Alert severity="error" sx={{ mt: 2 }}>{localErr}</Alert>}
        {submitError && <Alert severity="error" sx={{ mt: 2, whiteSpace: 'pre-line' }}>{submitError}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: 'none', fontWeight: 600 }}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={record.isPending}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          {record.isPending ? 'Saving…' : 'Save E-way Bill'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
