import { useMemo, useRef, useState } from 'react'
import { Banknote, History, Minus, Plus, ReceiptText, ScanBarcode, Smartphone, Trash2, XCircle } from 'lucide-react'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, InputAdornment, Paper,
  Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import { useBillingProducts, useBills, useCreateBill, useCancelBill } from '../../hooks/useBills'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import type { BillingProductDto, PaymentMode } from '../../api/bills/types'

// ─────────────────────────────────────────────────────────────────
// Phase 4 — POS billing screen (v1: issue + cancel, Cash/UPI, MRP
// pricing). Products + on-hand come from /api/bills/products; saving
// posts to /api/bills which decrements shop inventory atomically.
// A USB/Bluetooth barcode scanner types the code + Enter into the
// scan box — exact barcode-or-code matches add straight to the bill.
// ─────────────────────────────────────────────────────────────────

type BillLine = {
  product: BillingProductDto
  qty: number
}

export default function ShopBilling() {
  // 'pos' = the billing counter; 'history' = recent bills full-screen.
  // A toggle (not a below-the-grid section) so saved bills are one tap
  // away instead of a long scroll past the product grid.
  const [view, setView] = useState<'pos' | 'history'>('pos')
  const [scan, setScan] = useState('')
  const [lines, setLines] = useState<BillLine[]>([])
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash')
  const [savedBillCode, setSavedBillCode] = useState<string | null>(null)
  const [inlineError, setInlineError] = useState<string | null>(null)
  // Keep focus on the scan box — the scanner is keyboard-wedge hardware.
  const scanRef = useRef<HTMLInputElement>(null)

  const debouncedScan = useDebouncedValue(scan.trim(), 250)
  const productsQuery = useBillingProducts(debouncedScan || undefined)
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data])

  const createBill = useCreateBill()

  const qtyInCart = (productId: string) =>
    lines.find(l => l.product.id === productId)?.qty ?? 0

  const addProduct = (p: BillingProductDto) => {
    setSavedBillCode(null)
    setInlineError(null)
    // Soft client-side stock guard — the server enforces it again inside
    // the transaction, this just avoids an obvious round-trip.
    if (qtyInCart(p.id) + 1 > p.onHand) {
      setInlineError(`Only ${p.onHand} in stock for ${p.name}.`)
      return
    }
    setLines(prev => {
      const i = prev.findIndex(l => l.product.id === p.id)
      if (i >= 0) {
        const next = [...prev]
        next[i] = { ...next[i], qty: next[i].qty + 1 }
        return next
      }
      return [...prev, { product: p, qty: 1 }]
    })
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

  const totalQty = lines.reduce((s, l) => s + l.qty, 0)
  const total = lines.reduce((s, l) => s + l.qty * l.product.mrp, 0)

  const handleSave = () => {
    setInlineError(null)
    createBill.mutate(
      {
        paymentMode,
        items: lines.map(l => ({ productId: l.product.id, qty: l.qty })),
      },
      {
        onSuccess: created => {
          setSavedBillCode(created.code)
          setLines([])
          setPaymentMode('Cash')
          scanRef.current?.focus()
        },
        onError: err => {
          setInlineError(err instanceof Error ? err.message : 'Failed to save the bill.')
        },
      },
    )
  }

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle={view === 'pos'
          ? 'Scan a barcode or tap a product to add it to the bill'
          : 'Bills saved by your shop — cancel puts items back in stock'}
        action={
          <Button
            variant={view === 'history' ? 'contained' : 'outlined'}
            startIcon={view === 'history' ? <ReceiptText className="w-4 h-4" /> : <History className="w-4 h-4" />}
            onClick={() => setView(v => (v === 'pos' ? 'history' : 'pos'))}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {view === 'pos' ? 'Recent Bills' : 'Back to Billing'}
          </Button>
        }
      />

      {view === 'history' ? (
        <RecentBills />
      ) : (
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 420px' },
          gap: 2,
          alignItems: 'start',
        }}
      >
        {/* ── Left: scan box + product quick-pick ─────────────── */}
        <Box>
          <TextField
            fullWidth
            inputRef={scanRef}
            autoFocus
            value={scan}
            onChange={e => { setScan(e.target.value); setInlineError(null) }}
            onKeyDown={e => { if (e.key === 'Enter') handleScanEnter() }}
            placeholder="Scan barcode or search product…"
            sx={{ mb: 2, '& .MuiOutlinedInput-root': { bgcolor: '#FFFFFF', fontWeight: 600 } }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <ScanBarcode className="w-5 h-5 text-[#1F1F1F]" />
                  </InputAdornment>
                ),
                endAdornment: productsQuery.isFetching ? (
                  <InputAdornment position="end">
                    <CircularProgress size={16} />
                  </InputAdornment>
                ) : undefined,
              },
            }}
          />
          {inlineError && <Alert severity="warning" sx={{ mb: 2 }}>{inlineError}</Alert>}
          {productsQuery.isError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {productsQuery.error instanceof Error ? productsQuery.error.message : 'Failed to load products.'}
            </Alert>
          )}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)' },
              gap: 1.5,
            }}
          >
            {products.map(p => {
              const out = p.onHand <= 0
              return (
                <Paper
                  key={p.id}
                  elevation={0}
                  onClick={() => { if (!out) addProduct(p) }}
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    border: '2px solid rgba(31,31,31,0.2)',
                    bgcolor: out ? '#F5F5F5' : '#FFFBE6',
                    cursor: out ? 'not-allowed' : 'pointer',
                    opacity: out ? 0.6 : 1,
                    transition: 'all 0.15s',
                    ...(!out && { '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FFF4B8' } }),
                  }}
                >
                  <Box sx={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3, mb: 0.5 }}>{p.name}</Box>
                  <Box sx={{ fontSize: 11, color: '#1F1F1F99', mb: 1 }}>
                    {p.weightValue != null ? `${p.weightValue} ${p.weightUnit ?? ''} · ` : ''}{p.code}
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box sx={{ fontWeight: 700, fontSize: 14 }}>{formatINR(p.mrp)}</Box>
                    <Chip
                      label={out ? 'Out of stock' : `${p.onHand} left`}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: 10,
                        fontWeight: 700,
                        bgcolor: out ? '#C62828' : p.onHand < 5 ? '#FFF4B8' : '#E8F5E9',
                        color: out ? '#FFFFFF' : p.onHand < 5 ? '#8B6E00' : '#2E7D32',
                      }}
                    />
                  </Box>
                </Paper>
              )
            })}
            {products.length === 0 && !productsQuery.isLoading && (
              <Box sx={{ gridColumn: '1 / -1', textAlign: 'center', color: '#1F1F1F99', py: 4 }}>
                {debouncedScan ? `No products match “${debouncedScan}”.` : 'No products available.'}
              </Box>
            )}
          </Box>
        </Box>

        {/* ── Right: the bill ─────────────────────────────────── */}
        <Paper
          elevation={0}
          sx={{
            borderRadius: 2,
            border: '2px solid #1F1F1F',
            bgcolor: '#FFFFFF',
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
                {lines.map(l => (
                  <TableRow key={l.product.id} sx={{ bgcolor: '#FFFBE6' }}>
                    <TableCell>
                      <Box sx={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>{l.product.name}</Box>
                      <Box sx={{ fontSize: 11, color: '#1F1F1F99' }}>{formatINR(l.product.mrp)} each</Box>
                    </TableCell>
                    <TableCell align="center">
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                        <IconButton size="small" onClick={() => setQty(l.product.id, l.qty - 1)} aria-label="Decrease">
                          <Minus className="w-3.5 h-3.5" />
                        </IconButton>
                        <Box sx={{ fontWeight: 700, minWidth: 24, textAlign: 'center' }}>{l.qty}</Box>
                        <IconButton size="small" onClick={() => setQty(l.product.id, l.qty + 1)} aria-label="Increase">
                          <Plus className="w-3.5 h-3.5" />
                        </IconButton>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {formatINR(l.qty * l.product.mrp)}
                    </TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => setQty(l.product.id, 0)} aria-label="Remove">
                        <Trash2 className="w-3.5 h-3.5 text-[#C62828]" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Box sx={{ borderTop: '2px solid rgba(31,31,31,0.15)', px: 2, py: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 2 }}>
              <Box sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99' }}>
                Grand Total
              </Box>
              <Box sx={{ fontSize: 24, fontWeight: 800 }}>{formatINR(total)}</Box>
            </Box>

            {/* Payment mode — Cash / UPI, single tender in v1. */}
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              {([
                { mode: 'Cash' as const, icon: <Banknote className="w-4 h-4" /> },
                { mode: 'UPI'  as const, icon: <Smartphone className="w-4 h-4" /> },
              ]).map(({ mode, icon }) => {
                const active = paymentMode === mode
                return (
                  <Button
                    key={mode}
                    fullWidth
                    disableElevation
                    variant={active ? 'contained' : 'outlined'}
                    startIcon={icon}
                    onClick={() => setPaymentMode(mode)}
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
            </Box>

            <Button
              fullWidth
              variant="contained"
              size="large"
              disabled={lines.length === 0 || createBill.isPending}
              onClick={handleSave}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              {createBill.isPending ? 'Saving…' : `Save Bill · ${formatINR(total)}`}
            </Button>
          </Box>
        </Paper>
      </Box>
      )}
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
  const [reason, setReason] = useState('')
  const [cancelError, setCancelError] = useState<string | null>(null)

  const rows = list.data?.items ?? []
  const total = list.data?.total ?? 0

  const handleConfirmCancel = () => {
    if (!cancelTarget) return
    setCancelError(null)
    cancelBill.mutate(
      { id: cancelTarget.id, reason: reason.trim() },
      {
        onSuccess: () => { setCancelTarget(null); setReason('') },
        onError: err => setCancelError(err instanceof Error ? err.message : 'Failed to cancel the bill.'),
      },
    )
  }

  return (
    <Box>
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
                <TableCell sx={{ ...HEAD_SX, width: 110 }} align="center">Action</TableCell>
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
                <TableRow key={b.id} sx={{ bgcolor: '#FFFBE6' }}>
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
                  <TableCell align="center">
                    {b.status === 'Issued' && (
                      <Button
                        size="small"
                        color="error"
                        startIcon={<XCircle className="w-3.5 h-3.5" />}
                        onClick={() => { setCancelTarget({ id: b.id, code: b.code }); setReason(''); setCancelError(null) }}
                        sx={{ textTransform: 'none', fontWeight: 700 }}
                      >
                        Cancel
                      </Button>
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

      {/* Cancel-with-reason dialog. Cancelling reverses the stock decrement. */}
      <Dialog open={!!cancelTarget} onClose={() => setCancelTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Cancel bill {cancelTarget?.code}?</DialogTitle>
        <DialogContent>
          <Box sx={{ fontSize: 13, color: '#1F1F1F99', mb: 2 }}>
            The sold items go back into your shop stock. This cannot be undone.
          </Box>
          {cancelError && <Alert severity="error" sx={{ mb: 2 }}>{cancelError}</Alert>}
          <TextField
            fullWidth
            autoFocus
            multiline
            minRows={2}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Reason (required) — e.g. wrong items billed"
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCancelTarget(null)} sx={{ textTransform: 'none', fontWeight: 700 }}>
            Keep Bill
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={!reason.trim() || cancelBill.isPending}
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

const HEAD_SX = {
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  fontSize: 11,
  bgcolor: '#FFF8DC',
}
