import { useMemo, useRef, useState } from 'react'
import { Banknote, CreditCard, History, LayoutGrid, Minus, PauseCircle, Percent, Plus, Printer, ReceiptText, ScanBarcode, Smartphone, Trash2, Undo2, Users, Wallet, XCircle } from 'lucide-react'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, InputAdornment, MenuItem, Paper,
  Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import { useBillingProducts, useBills, useBill, useCreateBill, useCancelBill, useCreateHold } from '../../hooks/useBills'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import ReturnBillDialog from '../../components/billing/ReturnBillDialog'
import CustomerBar from '../../components/billing/CustomerBar'
import CreditCustomers from '../../components/billing/CreditCustomers'
import HeldBills, { type ResumeLine } from '../../components/billing/HeldBills'
import ProductBrowser from '../../components/billing/ProductBrowser'
import DiscountDialog, { type BillDiscount } from '../../components/billing/DiscountDialog'
import EodCloseDialog from '../../components/billing/EodCloseDialog'
import LooseWeightDialog from '../../components/billing/LooseWeightDialog'
import type { BillingProductDto, TenderMode, CancelReasonType } from '../../api/bills/types'
import type { CustomerDto } from '../../api/customers/types'

const CANCEL_REASONS: { value: CancelReasonType; label: string }[] = [
  { value: 'Mistake', label: 'Billing mistake' },
  { value: 'Duplicate', label: 'Duplicate bill' },
  { value: 'CustomerRefused', label: 'Customer refused' },
  { value: 'Other', label: 'Other' },
]
const cancelReasonLabel = (t: CancelReasonType | null) =>
  CANCEL_REASONS.find(r => r.value === t)?.label ?? t ?? ''

// ─────────────────────────────────────────────────────────────────
// Phase 4 — POS billing screen (v1: issue + cancel, Cash/UPI, MRP
// pricing). Products + on-hand come from /api/bills/products; saving
// posts to /api/bills which decrements shop inventory atomically.
// A USB/Bluetooth barcode scanner types the code + Enter into the
// scan box — exact barcode-or-code matches add straight to the bill.
// ─────────────────────────────────────────────────────────────────

// 01-Aug-2026 (Phase 4c): loose-sale support layered on top of packet mode.
// XOR at the line level — a line is EITHER a packet count (qty > 0) OR a
// loose weight (looseWeightG > 0). Mirrors the BE DTO.
type BillLine = {
  product: BillingProductDto
  qty?: number | null
  looseWeightG?: number | null
}

/** Pack size in grams — used by both amount + stock-guard math for loose. */
function packSizeGrams(p: BillingProductDto): number | null {
  if (!p.weightValue || p.weightValue <= 0) return null
  if (p.weightUnit === 'kg') return p.weightValue * 1000
  if (p.weightUnit === 'g')  return p.weightValue
  return null
}

/** Whole packets a line consumes from on_hand. Packet mode = qty; loose mode
 *  = ceil(weight/pack) so opening a pack to sell 300g deducts 1 packet. */
function linePacketsConsumed(l: BillLine): number {
  if (l.qty != null) return l.qty
  if (l.looseWeightG != null) {
    const pack = packSizeGrams(l.product)
    if (pack) return Math.ceil(l.looseWeightG / pack)
  }
  return 0
}

/** Money for a cart line — packet: qty × mrp; loose: (g/packG) × mrp. */
function lineAmount(l: BillLine): number {
  if (l.qty != null) return l.qty * l.product.mrp
  if (l.looseWeightG != null) {
    const pack = packSizeGrams(l.product)
    if (pack) return (l.looseWeightG / pack) * l.product.mrp
  }
  return 0
}

export default function ShopBilling() {
  // 'pos' = the billing counter; 'history' = recent bills full-screen.
  // A toggle (not a below-the-grid section) so saved bills are one tap
  // away instead of a long scroll past the product grid.
  const [view, setView] = useState<'pos' | 'history' | 'credit'>('pos')
  const [scan, setScan] = useState('')
  const [lines, setLines] = useState<BillLine[]>([])
  // Split payment (feature #5): one tender = single mode (amount tracks the
  // total implicitly); add a second to split across Cash / UPI / Credit.
  const [payments, setPayments] = useState<{ mode: TenderMode; amount: number }[]>([
    { mode: 'Cash', amount: 0 },
  ])
  // Attached customer (features #6 + #4) — required for a Credit tender.
  const [customer, setCustomer] = useState<CustomerDto | null>(null)
  const [savedBillCode, setSavedBillCode] = useState<string | null>(null)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [browseOpen, setBrowseOpen] = useState(false)
  // Phase 4c — bill-level discount. null = no discount. Percent → 0-100,
  // Amount → flat ₹ off. Cleared on every cart reset (new bill).
  const [discount, setDiscount] = useState<BillDiscount>(null)
  const [discountOpen, setDiscountOpen] = useState(false)
  // Phase 4c — EOD close-out dialog.
  const [eodOpen, setEodOpen] = useState(false)
  // Phase 4c — loose-weight dialog. Set to the product being weighed; null
  // = dialog closed. Cashier commits weight via LooseWeightDialog.onConfirm.
  const [looseTarget, setLooseTarget] = useState<BillingProductDto | null>(null)
  // Keep focus on the scan box — the scanner is keyboard-wedge hardware.
  const scanRef = useRef<HTMLInputElement>(null)

  const debouncedScan = useDebouncedValue(scan.trim(), 250)
  const productsQuery = useBillingProducts(debouncedScan || undefined)
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data])
  // Search-first: with no search term we show only a short quick-pick of
  // in-stock items instead of the whole catalogue (client 25-Jul-2026).
  const isSearching = debouncedScan.length > 0
  // The product side panel shows whenever browsing OR searching — search
  // results land in the same split pane as Browse (bill stays on the right).
  const showPanel = browseOpen || isSearching

  const createBill = useCreateBill()
  const createHold = useCreateHold()

  const qtyInCart = (productId: string) => {
    const line = lines.find(l => l.product.id === productId)
    return line ? linePacketsConsumed(line) : 0
  }

  const addProduct = (p: BillingProductDto) => {
    setSavedBillCode(null)
    setInlineError(null)
    // Phase 4c — sold-loose products branch to the weight dialog instead
    // of auto-adding a packet. Once weight is confirmed, addLooseLine
    // pushes the line with looseWeightG set + qty null.
    if (p.soldLoose) {
      setLooseTarget(p)
      return
    }
    // Soft client-side stock guard — the server enforces it again inside
    // the transaction, this just avoids an obvious round-trip.
    if (qtyInCart(p.id) + 1 > p.onHand) {
      setInlineError(`Only ${p.onHand} in stock for ${p.name}.`)
      return
    }
    setLines(prev => {
      const i = prev.findIndex(l => l.product.id === p.id)
      if (i >= 0) {
        // Only bump the qty on packet lines. A loose line for the same SKU
        // stays as-is; opening the dialog for the same product would let
        // the cashier weigh more if desired.
        const existing = prev[i]
        if (existing.qty == null) {
          setInlineError(`${p.name} is already on the bill as a loose sale — remove it first to switch to packets.`)
          return prev
        }
        const next = [...prev]
        next[i] = { ...next[i], qty: (existing.qty ?? 0) + 1 }
        return next
      }
      return [...prev, { product: p, qty: 1 }]
    })
  }

  /** Called by LooseWeightDialog.onConfirm — the dialog has already run the
   *  weight > 0 and stock checks, so we just push the line and close. */
  const addLooseLine = (looseWeightG: number) => {
    if (!looseTarget) return
    setLines(prev => {
      const i = prev.findIndex(l => l.product.id === looseTarget.id)
      if (i >= 0) {
        setInlineError(`${looseTarget.name} is already on the bill — remove it first to change weight.`)
        return prev
      }
      return [...prev, { product: looseTarget, qty: null, looseWeightG }]
    })
    setLooseTarget(null)
  }

  const setQty = (id: string, qty: number) => {
    setInlineError(null)
    setLines(prev => {
      if (qty <= 0) return prev.filter(l => l.product.id !== id)
      const line = prev.find(l => l.product.id === id)
      if (line && qty > line.product.onHand) {
        setInlineError(`Only ${line.product.onHand} in stock for ${line.product.name}.`)
        return prev
      }
      return prev.map(l => (l.product.id === id ? { ...l, qty } : l))
    })
  }

  // Scanner path: exact barcode/code match on Enter adds instantly.
  const handleScanEnter = () => {
    const term = scan.trim()
    if (!term) return
    const hit = products.find(
      p => p.barcode === term || p.code === term
        || p.name.toLowerCase() === term.toLowerCase(),
    )
    if (hit) {
      addProduct(hit)
      setScan('')
    } else if (!productsQuery.isFetching) {
      setInlineError(`No product found for "${term}"`)
    }
    scanRef.current?.focus()
  }

  const totalQty = lines.reduce((s, l) => s + linePacketsConsumed(l), 0)
  // Phase 4c: subtotal = pre-discount line sum. total = post-discount amount
  // the customer actually pays (matches SP's total_amount + payment settle).
  // Loose lines contribute (weight/pack) × mrp via lineAmount().
  const subtotal = lines.reduce((s, l) => s + lineAmount(l), 0)
  const discountAmount = discount == null
    ? 0
    : discount.kind === 'Percent'
      ? Math.min(subtotal, Math.round(subtotal * discount.value) / 100)
      : Math.min(subtotal, discount.value)
  const total = subtotal - discountAmount

  // Payment maths. Single tender ⇒ amount is implicitly the full total.
  const isSplit = payments.length > 1
  const round2 = (n: number) => Math.round(n * 100) / 100
  const paidSum = isSplit ? round2(payments.reduce((s, p) => s + (p.amount || 0), 0)) : total
  const remaining = round2(total - paidSum)
  const paymentsValid = !isSplit
    ? true
    : payments.every(p => p.amount > 0) && remaining === 0

  const setTenderMode = (i: number, mode: TenderMode) =>
    setPayments(prev => prev.map((p, idx) => (idx === i ? { ...p, mode } : p)))

  // Removing the customer invalidates any Credit tender — fall back to Cash.
  const handleCustomerChange = (c: CustomerDto | null) => {
    setCustomer(c)
    if (!c) setPayments(prev => prev.map(p => (p.mode === 'Credit' ? { ...p, mode: 'Cash' } : p)))
  }

  const setTenderAmount = (i: number, amount: number) =>
    setPayments(prev => prev.map((p, idx) => (idx === i ? { ...p, amount: Math.max(0, amount) } : p)))

  const addTender = () => setPayments(prev => {
    // Materialise the implicit single-tender amount, then add a second
    // tender pre-filled with whatever is still unpaid.
    const base = prev.length === 1 ? [{ ...prev[0], amount: total }] : prev
    const used = base.reduce((s, p) => s + (p.amount || 0), 0)
    return [...base, { mode: 'UPI', amount: Math.max(0, round2(total - used)) }]
  })

  const removeTender = (i: number) => setPayments(prev => {
    const next = prev.filter((_, idx) => idx !== i)
    // Back to a single tender ⇒ amount becomes implicit again.
    return next.length === 1 ? [{ mode: next[0].mode, amount: 0 }] : next
  })

  const resetPayments = () => setPayments([{ mode: 'Cash', amount: 0 }])

  const handleSave = (opts?: { print?: boolean }) => {
    setInlineError(null)
    const reqPayments = isSplit
      ? payments.map(p => ({ mode: p.mode, amount: round2(p.amount) }))
      : [{ mode: payments[0].mode, amount: total }]
    createBill.mutate(
      {
        payments: reqPayments,
        items: lines.map(l => ({
          productId: l.product.id,
          qty: l.qty ?? null,
          looseWeightG: l.looseWeightG ?? null,
        })),
        customerId: customer?.id ?? null,
        // Phase 4c: bill-level discount rides on the payload — server
        // computes the ₹ actually taken off and stores it on the bill row.
        discountKind: discount?.kind ?? null,
        discountValue: discount?.value ?? null,
      },
      {
        onSuccess: created => {
          setSavedBillCode(created.code)
          setLines([])
          resetPayments()
          setCustomer(null)
          setDiscount(null)
          scanRef.current?.focus()
          // Save & Print opens the 80mm receipt in a new tab, which
          // auto-fires the browser print dialog.
          if (opts?.print) window.open(`/print/bill/${created.id}/thermal`, '_blank')
        },
        onError: err => {
          setInlineError(err instanceof Error ? err.message : 'Failed to save the bill.')
        },
      },
    )
  }

  // Park the current cart as a draft (no stock consumed) and clear the POS.
  const handleHold = () => {
    if (lines.length === 0) return
    setInlineError(null)
    createHold.mutate(
      {
        customerId: customer?.id ?? null,
        items: lines.map(l => ({
          productId: l.product.id,
          qty: l.qty ?? null,
          looseWeightG: l.looseWeightG ?? null,
        })),
      },
      {
        onSuccess: () => { setLines([]); resetPayments(); setCustomer(null); setDiscount(null); scanRef.current?.focus() },
        onError: err => setInlineError(err instanceof Error ? err.message : 'Failed to hold the bill.'),
      },
    )
  }

  // Resume a draft — replaces the current cart with the draft's lines
  // (rebuilt from fresh product data). Customer is re-attached by the
  // cashier if a credit sale is intended.
  const handleResume = (resumed: ResumeLine[]) => {
    setSavedBillCode(null); setInlineError(null)
    setLines(resumed)
    resetPayments()
    scanRef.current?.focus()
  }

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle={
          view === 'pos' ? 'Scan a barcode or tap a product to add it to the bill'
          : view === 'history' ? 'Bills saved by your shop — cancel puts items back in stock'
          : 'Customers who owe credit — settle repayments and view statements'
        }
        action={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {([
              { key: 'pos' as const, label: 'Billing', icon: <ReceiptText className="w-4 h-4" /> },
              { key: 'history' as const, label: 'Recent Bills', icon: <History className="w-4 h-4" /> },
              { key: 'credit' as const, label: 'Credit', icon: <CreditCard className="w-4 h-4" /> },
            ]).map(t => (
              <Button
                key={t.key}
                variant={view === t.key ? 'contained' : 'outlined'}
                startIcon={t.icon}
                onClick={() => setView(t.key)}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                {t.label}
              </Button>
            ))}
            {/* Phase 4c — Close Day sits outside the view-tab group since it
                isn't a view; it opens a modal for the end-of-day count. */}
            <Button
              variant="outlined"
              startIcon={<Wallet className="w-4 h-4" />}
              onClick={() => setEodOpen(true)}
              sx={{ textTransform: 'none', fontWeight: 700, borderColor: '#8A6200', color: '#8A6200' }}
            >
              Close Day
            </Button>
          </Box>
        }
      />

      {view === 'credit' ? (
        <CreditCustomers />
      ) : view === 'history' ? (
        <RecentBills />
      ) : (
      // Bill-first (client 25-Jul-2026): the bill fills the width. Pressing
      // Browse opens a product panel BESIDE the bill (split) — the bill
      // stays visible — instead of covering it.
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: showPanel
            ? { xs: '1fr', md: 'minmax(0, 1fr) minmax(440px, 560px)' }
            : '1fr',
          gap: 2,
          alignItems: 'start',
          maxWidth: showPanel ? 'none' : 880,
          mx: showPanel ? 0 : 'auto',
        }}
      >
        {showPanel && (
          <ProductBrowser
            search={debouncedScan}
            title={isSearching ? `Results for “${debouncedScan}”` : 'Browse products'}
            onClose={() => { setBrowseOpen(false); setScan('') }}
            onAdd={addProduct}
            qtyInCart={qtyInCart}
          />
        )}

        {/* ── Bill column ─────────────────────────────────────── */}
        <Box>
        {/* Top: scan / search + Browse toggle. */}
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <TextField
            fullWidth
            inputRef={scanRef}
            autoFocus
            value={scan}
            onChange={e => { setScan(e.target.value); setInlineError(null) }}
            onKeyDown={e => { if (e.key === 'Enter') handleScanEnter() }}
            placeholder="Scan barcode or search product…"
            sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#FFF8DC', fontWeight: 600 } }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <ScanBarcode className="w-5 h-5 text-[#1F1F1F]" />
                  </InputAdornment>
                ),
                endAdornment: productsQuery.isFetching ? (
                  <InputAdornment position="end"><CircularProgress size={16} /></InputAdornment>
                ) : undefined,
              },
            }}
          />
          <Button
            variant={browseOpen ? 'contained' : 'outlined'}
            startIcon={<LayoutGrid className="w-4 h-4" />}
            onClick={() => setBrowseOpen(o => !o)}
            sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap', ...(browseOpen ? {} : { color: '#1F1F1F', borderColor: 'rgba(31,31,31,0.35)' }), px: 2.5 }}
          >
            {browseOpen ? 'Hide' : 'Browse'}
          </Button>
        </Box>

        {inlineError && <Alert severity="warning" sx={{ mb: 2 }}>{inlineError}</Alert>}
        {productsQuery.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {productsQuery.error instanceof Error ? productsQuery.error.message : 'Failed to load products.'}
          </Alert>
        )}

        {/* ── The bill ────────────────────────────────────────── */}
        <Paper
          elevation={0}
          sx={{
            borderRadius: 2,
            border: '2px solid #1F1F1F',
            bgcolor: '#FFF8DC',
            overflow: 'hidden',
            position: { md: 'sticky' },
            top: { md: 16 },
          }}
        >
          <Box sx={{ bgcolor: '#FCD835', px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <ReceiptText className="w-5 h-5" />
            <Box sx={{ fontWeight: 700, fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Current Bill
            </Box>
            <Box sx={{ flex: 1 }} />
            <Chip
              label={`${totalQty} ${totalQty === 1 ? 'item' : 'items'}`}
              size="small"
              sx={{ bgcolor: '#1F1F1F', color: '#FFD700', fontWeight: 700 }}
            />
          </Box>

          <Box sx={{ px: 2, pt: 1, display: 'flex', justifyContent: 'flex-end', borderBottom: '1px solid rgba(31,31,31,0.08)' }}>
            <HeldBills onResume={handleResume} />
          </Box>

          <Box sx={{ px: 2, pt: 2 }}>
            <CustomerBar customer={customer} onChange={handleCustomerChange} />
          </Box>

          {savedBillCode && (
            <Alert severity="success" sx={{ borderRadius: 0 }} onClose={() => setSavedBillCode(null)}>
              Bill <strong>{savedBillCode}</strong> saved — stock updated.
            </Alert>
          )}

          <TableContainer sx={{ maxHeight: 380 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={HEAD_SX}>Item</TableCell>
                  <TableCell sx={{ ...HEAD_SX, width: 110 }} align="center">Qty</TableCell>
                  <TableCell sx={{ ...HEAD_SX, width: 90 }} align="right">Total</TableCell>
                  <TableCell sx={{ width: 40 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ color: '#1F1F1F99', py: 5 }}>
                      Bill is empty — scan or tap a product.
                    </TableCell>
                  </TableRow>
                )}
                {lines.map(l => {
                  const isLoose = l.qty == null && l.looseWeightG != null
                  return (
                    <TableRow key={l.product.id} sx={{ bgcolor: '#FFFBE6' }}>
                      <TableCell>
                        <Box sx={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>
                          {l.product.name}
                          {isLoose && (
                            <Box component="span" sx={{ ml: 0.75, px: 0.75, py: 0.15, fontSize: 9, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#7C4A00', border: '1px solid #7C4A00', borderRadius: 0.5 }}>
                              LOOSE
                            </Box>
                          )}
                        </Box>
                        <Box sx={{ fontSize: 11, color: '#1F1F1F99' }}>
                          {isLoose ? `${formatINR(lineAmount(l))} @ ${l.looseWeightG} g` : `${formatINR(l.product.mrp)} each`}
                        </Box>
                      </TableCell>
                      <TableCell align="center">
                        {isLoose ? (
                          <Box sx={{ fontWeight: 700, fontFamily: 'monospace' }}>{l.looseWeightG} g</Box>
                        ) : (
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                            <IconButton size="small" onClick={() => setQty(l.product.id, (l.qty ?? 0) - 1)} aria-label="Decrease">
                              <Minus className="w-3.5 h-3.5" />
                            </IconButton>
                            <Box sx={{ fontWeight: 700, minWidth: 24, textAlign: 'center' }}>{l.qty}</Box>
                            <IconButton size="small" onClick={() => setQty(l.product.id, (l.qty ?? 0) + 1)} aria-label="Increase">
                              <Plus className="w-3.5 h-3.5" />
                            </IconButton>
                          </Box>
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {formatINR(lineAmount(l))}
                      </TableCell>
                      <TableCell>
                        <IconButton
                          size="small"
                          onClick={() => setLines(prev => prev.filter(x => x.product.id !== l.product.id))}
                          aria-label="Remove"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-[#C62828]" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>

          <Box sx={{ borderTop: '2px solid rgba(31,31,31,0.15)', px: 2, py: 2 }}>
            {/* Phase 4c — subtotal + discount rows only render when a
                discount is applied. Uncluttered look for the common no-
                discount path stays intact. */}
            {discount && (
              <>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, mb: 0.5, color: '#1F1F1F99' }}>
                  <span>Subtotal</span>
                  <span>{formatINR(subtotal)}</span>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, mb: 1, color: '#8A6200' }}>
                  <span>
                    Discount{discount.kind === 'Percent' ? ` (${discount.value}%)` : ''}
                    <Box component="button"
                      onClick={() => setDiscount(null)}
                      sx={{ ml: 1, border: 'none', bgcolor: 'transparent', color: '#C62828', fontSize: 12, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
                    >clear</Box>
                  </span>
                  <span>− {formatINR(discountAmount)}</span>
                </Box>
              </>
            )}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
              <Box sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99' }}>
                Grand Total
              </Box>
              <Box sx={{ fontSize: 24, fontWeight: 800 }}>{formatINR(total)}</Box>
            </Box>
            {/* Add-discount button — only appears when cart has lines AND
                no discount is set yet. Once applied, the discount row
                itself carries a "clear" affordance so the button doesn't
                need to duplicate that path. */}
            {lines.length > 0 && !discount && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                <Button
                  size="small"
                  startIcon={<Percent className="w-4 h-4" />}
                  onClick={() => setDiscountOpen(true)}
                  sx={{ textTransform: 'none', fontWeight: 700, fontSize: 12, color: '#8A6200' }}
                >
                  Add discount
                </Button>
              </Box>
            )}
            {discount && lines.length > 0 && <Box sx={{ mb: 2 }} />}

            {/* Payment — one tender by default; "Split" adds a second so a
                bill can be part Cash + part UPI (feature #5). */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
              {payments.map((p, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  {([
                    { mode: 'Cash' as const, icon: <Banknote className="w-4 h-4" /> },
                    { mode: 'UPI'  as const, icon: <Smartphone className="w-4 h-4" /> },
                    ...(customer ? [{ mode: 'Credit' as const, icon: <CreditCard className="w-4 h-4" /> }] : []),
                  ]).map(({ mode, icon }) => {
                    const active = p.mode === mode
                    return (
                      <Button
                        key={mode}
                        fullWidth
                        disableElevation
                        variant={active ? 'contained' : 'outlined'}
                        startIcon={icon}
                        onClick={() => setTenderMode(i, mode)}
                        sx={{
                          textTransform: 'none',
                          fontWeight: 700,
                          ...(active
                            ? {
                                background: 'linear-gradient(90deg, #C28A00 0%, #E6B800 35%, #FFD700 65%, #FFF1A6 100%)',
                                color: '#1F1F1F',
                              }
                            : { color: '#1F1F1F', borderColor: 'rgba(31,31,31,0.35)' }),
                        }}
                      >
                        {mode}
                      </Button>
                    )
                  })}
                  {isSplit && (
                    <>
                      <TextField
                        size="small"
                        type="number"
                        value={p.amount || ''}
                        onChange={e => setTenderAmount(i, parseFloat(e.target.value) || 0)}
                        placeholder="0"
                        sx={{ width: 110, '& input': { fontWeight: 700, textAlign: 'right' } }}
                        slotProps={{ input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> } }}
                      />
                      <IconButton size="small" onClick={() => removeTender(i)} aria-label="Remove tender">
                        <Trash2 className="w-3.5 h-3.5 text-[#C62828]" />
                      </IconButton>
                    </>
                  )}
                </Box>
              ))}

              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Button
                  size="small"
                  startIcon={<Plus className="w-3.5 h-3.5" />}
                  onClick={addTender}
                  disabled={lines.length === 0}
                  sx={{ textTransform: 'none', fontWeight: 700, color: '#1F1F1F' }}
                >
                  Split payment
                </Button>
                {isSplit && (
                  <Box sx={{ fontSize: 12, fontWeight: 700, color: remaining === 0 ? '#2E7D32' : '#C62828' }}>
                    {remaining > 0
                      ? `₹${remaining.toFixed(2)} left`
                      : remaining < 0
                        ? `₹${Math.abs(remaining).toFixed(2)} over`
                        : 'Balanced'}
                  </Box>
                )}
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                size="large"
                startIcon={<PauseCircle className="w-4 h-4" />}
                disabled={lines.length === 0 || createBill.isPending || createHold.isPending}
                onClick={handleHold}
                sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap', color: '#1F1F1F', borderColor: 'rgba(31,31,31,0.35)', flex: '0 0 auto', px: 2 }}
              >
                {createHold.isPending ? '…' : 'Hold'}
              </Button>
              <Button
                variant="outlined"
                size="large"
                disabled={lines.length === 0 || createBill.isPending || !paymentsValid}
                onClick={() => handleSave()}
                sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap', color: '#1F1F1F', borderColor: 'rgba(31,31,31,0.35)', flex: '0 0 auto', px: 3 }}
              >
                {createBill.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button
                fullWidth
                variant="contained"
                size="large"
                startIcon={<Printer className="w-4 h-4" />}
                disabled={lines.length === 0 || createBill.isPending || !paymentsValid}
                onClick={() => handleSave({ print: true })}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                {createBill.isPending ? 'Saving…' : `Save & Print · ${formatINR(total)}`}
              </Button>
            </Box>
          </Box>
        </Paper>
        </Box>
      </Box>
      )}

      {/* Phase 4c — Bill-level discount picker, rendered at the ShopBilling
          root so it can see the discount state. */}
      <DiscountDialog
        open={discountOpen}
        onClose={() => setDiscountOpen(false)}
        subtotal={subtotal}
        current={discount}
        onApply={setDiscount}
      />

      {/* Phase 4c — EOD close-out dialog. onClosed refires the recent-bills
          list (via the eod hook's invalidate) but nothing needs to happen at
          this layer besides shutting the modal. */}
      <EodCloseDialog
        open={eodOpen}
        onClose={() => setEodOpen(false)}
        onClosed={() => setEodOpen(false)}
      />

      {/* Phase 4c — Loose-weight picker. Opens when a cashier clicks a
          sold_loose product; confirmed weight pushes a loose line. */}
      <LooseWeightDialog
        open={!!looseTarget}
        product={looseTarget}
        onClose={() => setLooseTarget(null)}
        onConfirm={addLooseLine}
      />
    </div>
  )
}

// ───────────────────────────────────────────────────────────────
// Recent bills — history strip below the POS. Cancel puts the goods
// back on the shelf (server-side Refund movements) with a reason.
// ───────────────────────────────────────────────────────────────

function RecentBills() {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const list = useBills({ page: page + 1, pageSize })
  const cancelBill = useCancelBill()

  const [cancelTarget, setCancelTarget] = useState<{ id: string; code: string } | null>(null)
  const [cancelReasonType, setCancelReasonType] = useState<CancelReasonType>('Mistake')
  const [cancelNote, setCancelNote] = useState('')
  const [cancelError, setCancelError] = useState<string | null>(null)
  // Row click → bill detail dialog with the line items.
  const [detailId, setDetailId] = useState<string | null>(null)
  // Return-items dialog + last-saved-return confirmation.
  const [returnTarget, setReturnTarget] = useState<{ id: string; code: string } | null>(null)
  const [returnedMsg, setReturnedMsg] = useState<string | null>(null)

  const rows = list.data?.items ?? []
  const total = list.data?.total ?? 0

  const closeCancel = () => {
    setCancelTarget(null); setCancelReasonType('Mistake'); setCancelNote(''); setCancelError(null)
  }

  const handleConfirmCancel = () => {
    if (!cancelTarget) return
    setCancelError(null)
    cancelBill.mutate(
      {
        id: cancelTarget.id,
        req: {
          reasonType: cancelReasonType,
          reasonNote: cancelNote.trim() || null,
        },
      },
      {
        onSuccess: () => closeCancel(),
        onError: err => setCancelError(err instanceof Error ? err.message : 'Failed to cancel the bill.'),
      },
    )
  }

  return (
    <Box>
      {returnedMsg && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setReturnedMsg(null)}>
          Return <strong>{returnedMsg}</strong> saved — items back in stock, refund recorded.
        </Alert>
      )}
      <Paper elevation={0} sx={{ borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFFFFF', overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FCD835' }}>
                <TableCell sx={HEAD_SX}>Bill No</TableCell>
                <TableCell sx={HEAD_SX}>Time</TableCell>
                <TableCell sx={HEAD_SX} align="center">Items</TableCell>
                <TableCell sx={HEAD_SX} align="right">Amount</TableCell>
                <TableCell sx={HEAD_SX} align="center">Payment</TableCell>
                <TableCell sx={HEAD_SX} align="center">Status</TableCell>
                <TableCell sx={{ ...HEAD_SX, width: 190 }} align="center">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && !list.isLoading && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ color: '#1F1F1F99', py: 4 }}>
                    No bills yet.
                  </TableCell>
                </TableRow>
              )}
              {rows.map(b => (
                <TableRow
                  key={b.id}
                  hover
                  onClick={() => setDetailId(b.id)}
                  sx={{ bgcolor: '#FFFBE6', cursor: 'pointer' }}
                >
                  <TableCell sx={{ fontWeight: 700 }}>{b.code}</TableCell>
                  <TableCell>{formatIstDateTime(b.createdAt)}</TableCell>
                  <TableCell align="center">{b.totalQty}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{formatINR(b.totalAmount)}</TableCell>
                  <TableCell align="center">{b.paymentMode}</TableCell>
                  <TableCell align="center">
                    <Chip
                      label={b.status}
                      size="small"
                      variant={b.status === 'Cancelled' ? 'filled' : 'outlined'}
                      sx={b.status === 'Cancelled'
                        ? { bgcolor: '#C62828', color: '#FFFFFF', fontWeight: 700 }
                        : { borderColor: '#2E7D32', color: '#2E7D32', fontWeight: 700 }}
                    />
                  </TableCell>
                  <TableCell align="center" onClick={e => e.stopPropagation()}>
                    {b.status === 'Issued' && (
                      <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                        <Button
                          size="small"
                          startIcon={<Undo2 className="w-3.5 h-3.5" />}
                          onClick={() => { setReturnTarget({ id: b.id, code: b.code }); setReturnedMsg(null) }}
                          sx={{ textTransform: 'none', fontWeight: 700, color: '#1F1F1F' }}
                        >
                          Return
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          startIcon={<XCircle className="w-3.5 h-3.5" />}
                          onClick={() => { setCancelTarget({ id: b.id, code: b.code }); setCancelReasonType('Mistake'); setCancelNote(''); setCancelError(null) }}
                          sx={{ textTransform: 'none', fontWeight: 700 }}
                        >
                          Cancel
                        </Button>
                      </Box>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={e => { setPageSize(parseInt(e.target.value, 10)); setPage(0) }}
          rowsPerPageOptions={[10, 25, 50]}
        />
      </Paper>

      <BillDetailDialog billId={detailId} onClose={() => setDetailId(null)} />

      <ReturnBillDialog
        billId={returnTarget?.id ?? null}
        billCode={returnTarget?.code ?? null}
        onClose={() => setReturnTarget(null)}
        onDone={code => { setReturnTarget(null); setReturnedMsg(code) }}
      />

      {/* Cancel dialog — reason category + optional note. */}
      <Dialog open={!!cancelTarget} onClose={closeCancel} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Cancel bill {cancelTarget?.code}?</DialogTitle>
        <DialogContent>
          <Box sx={{ fontSize: 13, color: '#1F1F1F99', mb: 2 }}>
            The sold items go back into your shop stock. This cannot be undone.
          </Box>
          {cancelError && <Alert severity="error" sx={{ mb: 2 }}>{cancelError}</Alert>}
          <TextField
            select
            fullWidth
            label="Reason"
            value={cancelReasonType}
            onChange={e => setCancelReasonType(e.target.value as CancelReasonType)}
            sx={{ mb: 2 }}
          >
            {CANCEL_REASONS.map(r => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
          </TextField>
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Note (optional)"
            value={cancelNote}
            onChange={e => setCancelNote(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeCancel} sx={{ textTransform: 'none', fontWeight: 700 }}>
            Keep Bill
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={cancelBill.isPending}
            onClick={handleConfirmCancel}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {cancelBill.isPending ? 'Cancelling…' : 'Cancel Bill'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// Bill detail — line items, totals, and the cancellation trail if any.
// Read-only by design: an issued bill is a financial record; fixing a
// mistake = Cancel (stock returns) + make a new bill.
function BillDetailDialog({ billId, onClose }: { billId: string | null; onClose: () => void }) {
  const bill = useBill(billId ?? undefined)
  const b = bill.data

  return (
    <Dialog open={!!billId} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        <ReceiptText className="w-5 h-5" />
        {b ? `Bill ${b.code}` : 'Bill'}
        {b && (
          <Chip
            label={b.status}
            size="small"
            sx={b.status === 'Cancelled'
              ? { bgcolor: '#C62828', color: '#FFFFFF', fontWeight: 700, ml: 1 }
              : { bgcolor: '#E8F5E9', color: '#2E7D32', fontWeight: 700, ml: 1 }}
          />
        )}
      </DialogTitle>
      <DialogContent dividers>
        {bill.isLoading && <Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress size={24} /></Box>}
        {bill.isError && (
          <Alert severity="error">
            {bill.error instanceof Error ? bill.error.message : 'Failed to load the bill.'}
          </Alert>
        )}
        {b && (
          <>
            <Box sx={{ fontSize: 12, color: '#1F1F1F99', mb: 1.5 }}>
              {formatIstDateTime(b.createdAt)}
              {b.createdByName ? ` · billed by ${b.createdByName}` : ''} · {b.paymentMode}
            </Box>
            {b.customerName && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 13, fontWeight: 600, mb: 1.5 }}>
                <Users className="w-4 h-4 text-[#1F1F1F99]" />
                {b.customerName}{b.customerPhone ? ` · ${b.customerPhone}` : ''}
              </Box>
            )}
            {b.status === 'Cancelled' && (
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                Cancelled {b.cancelledAt ? formatIstDateTime(b.cancelledAt) : ''}
                {b.cancelledByName ? ` by ${b.cancelledByName}` : ''}
                {b.cancelReasonType ? ` — ${cancelReasonLabel(b.cancelReasonType)}` : ''}
                {b.cancelReason ? ` (${b.cancelReason})` : ''}
              </Alert>
            )}
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={HEAD_SX}>Item</TableCell>
                  <TableCell sx={HEAD_SX} align="center">Qty</TableCell>
                  <TableCell sx={HEAD_SX} align="right">Price</TableCell>
                  <TableCell sx={HEAD_SX} align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {b.items.map(i => {
                  const isLoose = i.qty == null && i.looseWeightG != null
                  return (
                    <TableRow key={i.id}>
                      <TableCell>
                        <Box sx={{ fontWeight: 600, fontSize: 13 }}>
                          {i.productName}
                          {isLoose && (
                            <Box component="span" sx={{ ml: 0.75, px: 0.75, py: 0.15, fontSize: 9, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#7C4A00', border: '1px solid #7C4A00', borderRadius: 0.5 }}>
                              LOOSE
                            </Box>
                          )}
                        </Box>
                        <Box sx={{ fontSize: 11, color: '#1F1F1F99' }}>
                          {i.weightValue != null ? `${i.weightValue} ${i.weightUnit ?? ''} · ` : ''}{i.productCode}
                        </Box>
                      </TableCell>
                      <TableCell align="center">{isLoose ? `${i.looseWeightG} g` : i.qty}</TableCell>
                      <TableCell align="right">{formatINR(i.unitPrice)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{formatINR(i.lineTotal)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {/* Phase 4c — subtotal + discount rows on the review dialog
                (only when a discount was applied on the original bill). */}
            {b.discountAmount > 0 && (
              <Box sx={{ mt: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#1F1F1F99' }}>
                  <span>Subtotal</span>
                  <span>{formatINR(b.subtotal)}</span>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#8A6200' }}>
                  <span>Discount{b.discountKind === 'Percent' && b.discountValue != null ? ` (${b.discountValue}%)` : ''}</span>
                  <span>− {formatINR(b.discountAmount)}</span>
                </Box>
              </Box>
            )}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mt: b.discountAmount > 0 ? 0.5 : 2 }}>
              <Box sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99' }}>
                Grand Total
              </Box>
              <Box sx={{ fontSize: 20, fontWeight: 800 }}>{formatINR(b.totalAmount)}</Box>
            </Box>

            {/* Tender breakdown — always listed; a Split bill shows each part. */}
            {b.payments.length > 0 && (
              <Box sx={{ mt: 1.5, borderTop: '1px dashed rgba(31,31,31,0.2)', pt: 1 }}>
                {b.payments.map(p => (
                  <Box key={p.id} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, py: 0.25 }}>
                    <Box sx={{ color: '#1F1F1F99' }}>{p.mode}</Box>
                    <Box sx={{ fontWeight: 700 }}>{formatINR(p.amount)}</Box>
                  </Box>
                ))}
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        {b && (
          <Button
            startIcon={<Printer className="w-4 h-4" />}
            onClick={() => window.open(`/print/bill/${b.id}/thermal`, '_blank')}
            sx={{ textTransform: 'none', fontWeight: 700, color: '#1F1F1F' }}
          >
            Print receipt
          </Button>
        )}
        <Button onClick={onClose} variant="contained" sx={{ textTransform: 'none', fontWeight: 700 }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const HEAD_SX = {
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  fontSize: 11,
  bgcolor: '#FFF8DC',
}
