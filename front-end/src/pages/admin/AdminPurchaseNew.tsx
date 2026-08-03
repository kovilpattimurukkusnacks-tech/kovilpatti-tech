import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Trash2, Edit2, X, ArrowLeft } from 'lucide-react'
import {
  Alert, Autocomplete, Box, Button, IconButton, MenuItem, Paper, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Tooltip,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import { useToast } from '../../context/ToastContext'
import { formatINR } from '../../utils/format'
import { useVendors } from '../../hooks/useVendors'
import { useInventories } from '../../hooks/useInventories'
import { useProducts } from '../../hooks/useProducts'
import {
  useVendorPurchase, useCreateVendorPurchase, useUpdateVendorPurchase,
  useReceiveVendorPurchase, useCancelVendorPurchase,
} from '../../hooks/useVendorPurchases'
import { useEwayBillsForPurchase, useEwayInboundThreshold } from '../../hooks/useEwayBills'
import EwayBillSection from '../../components/eway/EwayBillSection'
import type { CreateVendorPurchaseItem } from '../../api/vendor-purchases/types'
import { ValidationError } from '../../api/errors'
import type { ProductDto } from '../../api/products/types'

const FETCH_ALL_PAGE_SIZE = 200

type LineItem = { productId: string; product: ProductDto; qty: number; unitCost: number }

function mutationErrorMessage(err: unknown): string | null {
  if (!err) return null
  if (err instanceof ValidationError) return err.flatten()
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}

export default function AdminPurchaseNew() {
  const navigate = useNavigate()
  const toast = useToast()
  const { id } = useParams<{ id?: string }>()
  const isEdit = !!id

  const vendorsQuery = useVendors()
  const godownsQuery = useInventories()
  const productsQuery = useProducts({ page: 1, pageSize: FETCH_ALL_PAGE_SIZE })
  const purchaseQuery = useVendorPurchase(id)

  const create = useCreateVendorPurchase()
  const update = useUpdateVendorPurchase()
  const receive = useReceiveVendorPurchase()
  const cancel = useCancelVendorPurchase()

  // Phase 5b: inbound e-way gate context. Threshold is app-wide (5-min cache
  // in the hook), the list is per-purchase. Both queries lazy — the list is
  // gated on `id` inside the hook.
  const thresholdQuery = useEwayInboundThreshold()
  const ewayListQuery  = useEwayBillsForPurchase(id)
  const inboundThreshold = thresholdQuery.data?.threshold ?? 0
  const ewayList = ewayListQuery.data ?? []
  const hasGeneratedEway = ewayList.some(r => r.status === 'Generated')

  const vendors  = vendorsQuery.data ?? []
  const godowns  = godownsQuery.data ?? []
  const products = productsQuery.data?.items ?? []

  const [vendorId, setVendorId] = useState('')
  const [godownId, setGodownId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [notes, setNotes] = useState('')

  const [items, setItems] = useState<LineItem[]>([])
  const [pickerProduct, setPickerProduct] = useState<ProductDto | null>(null)
  const [pickerQty, setPickerQty] = useState('')
  const [pickerCost, setPickerCost] = useState('')
  // Non-null while editing an already-added line — locks the product
  // picker (only qty/cost are editable) and swaps "Add Item" for "Update".
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const existing = purchaseQuery.data
  const isReceived = existing?.status === 'Received'
  // Read-only once Received; also while the existing purchase hasn't loaded yet.
  const readOnly = isEdit && (isReceived || purchaseQuery.isLoading)

  // Prefill from the loaded purchase when editing.
  useEffect(() => {
    if (!existing) return
    setVendorId(existing.vendorId)
    setGodownId(existing.godownId)
    setInvoiceNumber(existing.invoiceNumber)
    setInvoiceDate(existing.invoiceDate.slice(0, 10))
    setInvoiceAmount(String(existing.invoiceAmount))
    setNotes(existing.notes ?? '')
    if (existing.items) {
      setItems(existing.items.map(it => ({
        productId: it.productId,
        product: {
          id: it.productId, code: it.productCode, name: it.productName,
          barcode: null, categoryId: 0, categoryName: '', type: '',
          weightValue: it.weightValue, weightUnit: it.weightUnit,
          mrp: 0, purchasePrice: null, gst: null, active: true,
          // Purchase items are inbound-only — the loose-sale flag lives on
          // the retail (shop-side) product surface, so a synthetic stub
          // rebuilt from purchase-item snapshots always defaults false.
          soldLoose: false,
        },
        qty: it.qty,
        unitCost: it.unitCost,
      })))
    }
  }, [existing])

  useEffect(() => {
    if (!isEdit && godowns.length > 0 && !godownId) setGodownId(godowns[0].id)
  }, [isEdit, godowns, godownId])

  const vendor = vendors.find(v => v.id === vendorId) ?? null
  const isInterstate = isEdit ? (existing?.isInterstate ?? false) : (vendor?.isInterstate ?? false)

  const itemsTotal = useMemo(() => items.reduce((sum, i) => sum + i.qty * i.unitCost, 0), [items])

  const resetPicker = () => {
    setPickerProduct(null)
    setPickerQty('')
    setPickerCost('')
    setEditingProductId(null)
  }

  const addItem = () => {
    if (!pickerProduct) return
    const qty = parseFloat(pickerQty) || 0
    const cost = parseFloat(pickerCost) || 0
    if (qty <= 0) return

    if (editingProductId) {
      setItems(prev => prev.map(i => i.productId === editingProductId ? { ...i, qty, unitCost: cost } : i))
      setErr(null)
      resetPicker()
      return
    }

    if (items.some(i => i.productId === pickerProduct.id)) {
      setErr('That product is already on this purchase — edit the existing line instead.')
      return
    }
    setErr(null)
    setItems(prev => [...prev, { productId: pickerProduct.id, product: pickerProduct, qty, unitCost: cost }])
    resetPicker()
  }

  const startEditItem = (item: LineItem) => {
    setEditingProductId(item.productId)
    setPickerProduct(item.product)
    setPickerQty(String(item.qty))
    setPickerCost(String(item.unitCost))
    setErr(null)
  }

  const removeItem = (productId: string) => {
    setItems(prev => prev.filter(i => i.productId !== productId))
    if (editingProductId === productId) resetPicker()
  }

  const buildItemsPayload = (): CreateVendorPurchaseItem[] =>
    items.map(i => ({ productId: i.productId, qty: i.qty, unitCost: i.unitCost }))

  const handleSubmit = async () => {
    if (!vendorId) { setErr('Pick a vendor'); return }
    if (!godownId) { setErr('Pick a destination godown'); return }
    if (!invoiceNumber.trim()) { setErr('Enter the invoice number'); return }
    if (!invoiceDate) { setErr('Enter the invoice date'); return }
    const amountNum = parseFloat(invoiceAmount)
    if (!(amountNum >= 0)) { setErr('Enter a valid invoice amount'); return }
    if (items.length === 0) { setErr('Add at least one line item'); return }
    setErr(null)

    try {
      if (isEdit && id) {
        await update.mutateAsync({
          id,
          req: {
            invoiceNumber: invoiceNumber.trim(),
            invoiceDate,
            invoiceAmount: amountNum,
            notes: notes.trim() || undefined,
            items: buildItemsPayload(),
          },
        })
      } else {
        const created = await create.mutateAsync({
          vendorId,
          godownId,
          invoiceNumber: invoiceNumber.trim(),
          invoiceDate,
          invoiceAmount: amountNum,
          notes: notes.trim() || undefined,
          items: buildItemsPayload(),
        })
        toast.success({
          title: 'Purchase created',
          description: `${created.code} — ${created.vendorName}`,
        })
        navigate('/admin/purchases')
      }
    } catch {
      // Surfaces via submitError below
    }
  }

  const handleReceive = async () => {
    if (!id) return
    try {
      await receive.mutateAsync(id)
    } catch {
      // Surfaces via submitError below
    }
  }

  const handleCancel = async () => {
    if (!id) return
    try {
      await cancel.mutateAsync(id)
      navigate('/admin/purchases')
    } catch {
      // Surfaces via submitError below
    }
  }

  const submitError = mutationErrorMessage(create.error)
    ?? mutationErrorMessage(update.error)
    ?? mutationErrorMessage(receive.error)
    ?? mutationErrorMessage(cancel.error)

  const submitting = create.isPending || update.isPending || receive.isPending || cancel.isPending

  return (
    <div>
      <PageHeader
        title={isEdit ? (existing ? existing.code : 'Purchase') : 'New Purchase'}
        subtitle={isEdit ? (existing ? `${existing.status} — ${existing.vendorName}` : 'Loading…') : 'Create a new vendor purchase'}
        action={
          <Button startIcon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate('/admin/purchases')} sx={{ textTransform: 'none', fontWeight: 600 }}>
            Back to Purchases
          </Button>
        }
      />

      {isReceived && existing && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Received{existing.receivedByName ? ` by ${existing.receivedByName}` : ''}
          {existing.receivedAt ? ` on ${new Date(existing.receivedAt).toLocaleString('en-IN')}` : ''}. This purchase is locked from further edits.
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 3, borderRadius: 2, border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835', bgcolor: '#FFFFFF' }} elevation={0}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <TextField
            select label="Vendor" value={vendorId}
            onChange={e => setVendorId(e.target.value)}
            required size="small" disabled={isEdit || submitting}
          >
            {vendors.map(v => <MenuItem key={v.id} value={v.id}>{v.name}</MenuItem>)}
          </TextField>
          <TextField
            select label="Destination Godown" value={godownId}
            onChange={e => setGodownId(e.target.value)}
            required size="small" disabled={isEdit || submitting}
          >
            {godowns.map(g => <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>)}
          </TextField>
          <TextField label="Invoice Number" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} required size="small" disabled={readOnly || submitting} />
          <TextField label="Invoice Date" type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} required size="small" disabled={readOnly || submitting} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="Invoice Amount (₹)" type="number" value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)} required size="small" disabled={readOnly || submitting} />
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {(vendor || (isEdit && existing)) && (
              <Box sx={{
                fontSize: 13, fontWeight: 600, px: 1.5, py: 1, borderRadius: 1.5,
                bgcolor: isInterstate ? '#FFF3CD' : '#EAF7EE',
                border: `1px solid ${isInterstate ? '#E0A800' : '#2E7D32'}`,
                color: isInterstate ? '#8A6200' : '#2E7D32',
              }}>
                {isInterstate ? 'Interstate purchase (auto-derived from vendor state)' : 'Intrastate (Tamil Nadu) purchase'}
              </Box>
            )}
          </Box>
          <TextField label="Notes" value={notes} onChange={e => setNotes(e.target.value)} size="small" disabled={readOnly || submitting} multiline minRows={1} sx={{ gridColumn: { sm: '1 / -1' } }} />
        </Box>
      </Paper>

      <Paper sx={{ p: 3, mb: 3, borderRadius: 2, border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835', bgcolor: '#FFFFFF' }} elevation={0}>
        <Box sx={{ fontWeight: 700, mb: 2, textTransform: 'uppercase', fontSize: 14, letterSpacing: '0.03em' }}>Line Items</Box>

        {!readOnly && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', mb: 2 }}>
            <Autocomplete
              options={products}
              getOptionLabel={p => `${p.name} (${p.code})`}
              value={pickerProduct}
              onChange={(_e, v) => setPickerProduct(v)}
              sx={{ minWidth: 280 }}
              size="small"
              disabled={submitting || !!editingProductId}
              renderInput={params => <TextField {...params} label="Product" />}
            />
            <TextField label="Qty" type="number" size="small" value={pickerQty} onChange={e => setPickerQty(e.target.value)} sx={{ width: 100 }} disabled={submitting} />
            <TextField label="Unit Cost (₹)" type="number" size="small" value={pickerCost} onChange={e => setPickerCost(e.target.value)} sx={{ width: 140 }} disabled={submitting} />
            <Button variant="outlined" onClick={addItem} disabled={!pickerProduct || submitting} sx={{ textTransform: 'none', fontWeight: 600 }}>
              {editingProductId ? 'Update Item' : 'Add Item'}
            </Button>
            {editingProductId && (
              <IconButton size="small" onClick={resetPicker} disabled={submitting} title="Cancel edit">
                <X className="w-4 h-4" />
              </IconButton>
            )}
          </Box>
        )}

        {items.length === 0 ? (
          <Box sx={{ color: '#1F1F1F', opacity: 0.5, fontSize: 14, py: 2, textAlign: 'center' }}>No line items yet — add a product above.</Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Product</TableCell>
                <TableCell align="right">Qty</TableCell>
                <TableCell align="right">Unit Cost</TableCell>
                <TableCell align="right">Line Total</TableCell>
                {!readOnly && <TableCell align="right"></TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map(item => (
                <TableRow key={item.productId}>
                  <TableCell>{item.product.name}</TableCell>
                  <TableCell align="right">{item.qty}</TableCell>
                  <TableCell align="right">{formatINR(item.unitCost)}</TableCell>
                  <TableCell align="right">{formatINR(item.qty * item.unitCost)}</TableCell>
                  {!readOnly && (
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => startEditItem(item)} disabled={submitting}>
                        <Edit2 className="w-4 h-4" />
                      </IconButton>
                      <IconButton size="small" color="error" onClick={() => removeItem(item.productId)} disabled={submitting}>
                        <Trash2 className="w-4 h-4" />
                      </IconButton>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={3} sx={{ fontWeight: 700 }}>Total</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>{formatINR(itemsTotal)}</TableCell>
                {!readOnly && <TableCell />}
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Paper>

      {/* Phase 5b — E-way bill section. Only when editing (needs an id) AND
          the purchase is interstate. Non-interstate purchases don't need
          e-way at all; the section hides entirely rather than showing a
          "not required" note (which clutters the page). */}
      {isEdit && id && isInterstate && existing && (
        <EwayBillSection
          purchaseId={id}
          locked={isReceived}
          invoiceNumber={existing.invoiceNumber}
          invoiceDate={existing.invoiceDate}
          invoiceAmount={existing.invoiceAmount}
          gateActive={inboundThreshold > 0 && existing.invoiceAmount >= inboundThreshold}
        />
      )}

      {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
      {submitError && <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-line' }}>{submitError}</Alert>}

      {!readOnly && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
          {isEdit && existing?.status === 'Ordered' && (
            <Button variant="outlined" color="error" onClick={handleCancel} disabled={submitting} sx={{ textTransform: 'none', fontWeight: 600 }}>
              Cancel Purchase
            </Button>
          )}
          <Button variant="outlined" onClick={handleSubmit} disabled={submitting} sx={{ textTransform: 'none', fontWeight: 600 }}>
            {submitting ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create Purchase')}
          </Button>
          {isEdit && existing?.status === 'Ordered' && (() => {
            // Phase 5b gate: block "Mark Received" when interstate + at/above
            // threshold but no Generated e-way row attached. The BE enforces
            // the same rule (fn_vendor_purchase_receive returns 'eway_required'),
            // but disabling the button + tooltip makes the reason immediate.
            const gateActive = isInterstate && inboundThreshold > 0 && existing.invoiceAmount >= inboundThreshold
            const blocked = gateActive && !hasGeneratedEway
            return (
              <Tooltip title={blocked ? 'Add a Generated inbound e-way bill first — required for this interstate purchase.' : ''}>
                <span>
                  <Button
                    variant="contained"
                    onClick={handleReceive}
                    disabled={submitting || blocked}
                    sx={{ textTransform: 'none', fontWeight: 600 }}
                  >
                    Mark Received
                  </Button>
                </span>
              </Tooltip>
            )
          })()}
        </Box>
      )}
    </div>
  )
}
