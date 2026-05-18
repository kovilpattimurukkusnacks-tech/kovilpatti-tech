import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Trash2, ArrowLeft, ShoppingCart, X, Search } from 'lucide-react'
import {
  Alert, Autocomplete, Badge, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, Paper, Table, TableBody, TableCell,
  TableContainer, TableFooter, TableHead, TableRow, TextField,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import { useApp } from '../../context/AppContext'
import { useProducts } from '../../hooks/useProducts'
import { useCategories } from '../../hooks/useCategories'
import { useCreateStockRequest, useUpdateStockRequest, useStockRequest } from '../../hooks/useStockRequests'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import type { ProductDto } from '../../api/products/types'
import { ValidationError } from '../../api/errors'
import { formatINR } from '../../utils/format'

type CartLine = { product: ProductDto; qty: number }

// Large pageSize so we effectively load all matching products in one shot —
// the UI renders them in a two-column layout with no pagination footer.
// BE still caps at 200; if a catalog grows past that we'll switch to true
// "all-rows" SP or virtualized rendering.
const FETCH_ALL_PAGE_SIZE = 200

export default function ShopRequestNew() {
  const navigate = useNavigate()
  const { id: editId } = useParams<{ id?: string }>()
  const isEditMode = !!editId
  const { currentUser } = useApp()
  const isAdmin = currentUser?.role === 'Admin'
  // Admin lands here from /admin/requests/:id/edit, shop from /shop/requests/:id/edit
  const detailPath = isEditMode && editId
    ? (isAdmin ? `/admin/requests/${editId}` : `/shop/requests/${editId}`)
    : (isAdmin ? '/admin/requests' : '/shop/requests')

  const createMutation = useCreateStockRequest()
  const updateMutation = useUpdateStockRequest()
  const existingQuery  = useStockRequest(editId)
  const existing       = existingQuery.data

  // Browse / filter state — both category and type are multi-select.
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([])
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput, 300)

  const categoriesQuery = useCategories()
  const productsQuery = useProducts({
    categoryIds: selectedCategoryIds.length ? selectedCategoryIds : undefined,
    types:       selectedTypes.length       ? selectedTypes       : undefined,
    search:      debouncedSearch.trim() || undefined,
    page:        1,
    pageSize:    FETCH_ALL_PAGE_SIZE,
  })

  // Type filter options — mirrors the type dropdown in the Add Product form
  // (pages/Products.tsx). Keep these in sync if a new type is ever added.
  const TYPE_OPTIONS = ['pack', 'jar'] as const

  // Cart state — Map keyed by productId so add/update/remove is O(1).
  // Persists across category / search / page changes (intentionally).
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map())
  const [notes, setNotes] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)
  const [seeded, setSeeded] = useState(false)

  // In edit mode, seed cart + notes from the existing request once it loads.
  // Items contain enough info (id, code, name, unitPrice) to display the cart
  // without needing the full ProductDto.
  useEffect(() => {
    if (!isEditMode || !existing || seeded) return
    const map = new Map<string, CartLine>()
    for (const it of existing.items ?? []) {
      const stub: ProductDto = {
        id: it.productId,
        code: it.productCode,
        name: it.productName,
        mrp: it.unitPrice,
        // Carry weight forward from the snapshotted item so edit-mode rows
        // still display the pack size in the review dialog.
        weightValue: it.weightValue,
        weightUnit: it.weightUnit,
        // Fields not displayed in cart context — stubs to satisfy type
        categoryId: 0,
        categoryName: '',
        type: '',
        purchasePrice: null,
        gst: null,
        active: true,
      }
      map.set(it.productId, { product: stub, qty: it.requestedQty })
    }
    setCart(map)
    setNotes(existing.notes ?? '')
    setSeeded(true)
  }, [isEditMode, existing, seeded])

  // Edit-mode guard:
  //   • Shop user — only Pending, and only within editable_until.
  //   • Admin    — Pending or Approved, no time lock.
  const editWindowOpen = (() => {
    if (!isEditMode || !existing) return true
    if (isAdmin) {
      return existing.status === 'Pending' || existing.status === 'Approved'
    }
    if (existing.status !== 'Pending') return false
    return new Date() < new Date(existing.editableUntil)
  })()

  const categories = categoriesQuery.data ?? []
  const products   = productsQuery.data?.items ?? []

  // The product list re-renders into ~200 rows when filters change. That work
  // is heavy enough to block the Category Autocomplete from responding to
  // clicks. useDeferredValue lets React paint the urgent updates (dropdown
  // close, chip added) at high priority and re-renders the big table at
  // low priority, keeping the UI snappy.
  const deferredProducts = useDeferredValue(products)
  const [leftProducts, rightProducts] = useMemo(() => {
    const half = Math.ceil(deferredProducts.length / 2)
    return [deferredProducts.slice(0, half), deferredProducts.slice(half)] as const
  }, [deferredProducts])

  // Memoized Autocomplete value — stable array reference unless the selection
  // actually changes, otherwise MUI's option-equality scan would rerun every
  // render (200 products * filter check) and contribute to the dropdown freeze.
  const selectedCategoryValue = useMemo(
    () => categories.filter(c => selectedCategoryIds.includes(c.id)),
    [categories, selectedCategoryIds],
  )

  // Cart aggregates
  const { cartCount, cartTotal } = useMemo(() => {
    let count = 0, total = 0
    for (const line of cart.values()) {
      count += line.qty
      total += line.qty * line.product.mrp
    }
    return { cartCount: count, cartTotal: total }
  }, [cart])

  const distinctLines = cart.size

  // Stable identity across renders so memoized ProductRow children don't all
  // re-render when the cart changes. Uses functional setCart so it doesn't
  // need `cart` in its closure.
  const setQty = useCallback((product: ProductDto, qty: number) => {
    const clamped = Math.max(0, Math.min(1_000_000, Math.floor(qty)))
    setCart(prev => {
      const next = new Map(prev)
      if (clamped === 0) next.delete(product.id)
      else next.set(product.id, { product, qty: clamped })
      return next
    })
  }, [])

  const clearCart = () => {
    setCart(new Map())
    setNotes('')
    setLocalErr(null)
  }

  const handleSubmit = async () => {
    setLocalErr(null)
    if (cart.size === 0) {
      setLocalErr('Add at least one product to the request.')
      return
    }
    const items = Array.from(cart.values()).map(l => ({
      productId: l.product.id,
      requestedQty: l.qty,
    }))
    try {
      if (isEditMode && editId) {
        await updateMutation.mutateAsync({
          id: editId,
          req: { notes: notes.trim() || undefined, items },
        })
        navigate(isAdmin ? `/admin/requests/${editId}` : `/shop/requests/${editId}`)
      } else {
        const res = await createMutation.mutateAsync({
          notes: notes.trim() || undefined,
          items,
        })
        navigate(`/shop/requests/${res.id}`)
      }
    } catch {
      // shown via apiErrorMessage below
    }
  }

  const activeMutation = isEditMode ? updateMutation : createMutation

  const apiErrorMessage = (() => {
    const err = activeMutation.error
    if (!err) return null
    if (err instanceof ValidationError) return err.flatten()
    if (err instanceof Error) return err.message
    return 'Failed to save request.'
  })()

  // ───────────────────────────────────────────────────────────────

  return (
    <Box sx={{ pb: 12 /* leave room for sticky bottom bar */ }}>
      <PageHeader
        title={isEditMode ? `Edit ${existing?.code ?? 'Request'}` : 'New Stock Request'}
        subtitle={isEditMode
          ? (isAdmin
              ? 'Admin edit — adjust items or quantities on behalf of the shop.'
              : 'Update items or quantities. Changes apply until the cutoff.')
          : 'Type a quantity next to any product to add it to your request.'}
        action={
          <Button
            variant="outlined"
            startIcon={<ArrowLeft className="w-4 h-4" />}
            onClick={() => navigate(detailPath)}
            sx={{
              textTransform: 'none', fontWeight: 600,
              borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFFFFF',
              '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
            }}
          >
            Back
          </Button>
        }
      />

      {/* Edit-mode lock warning */}
      {isEditMode && existing && !editWindowOpen && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This request is no longer editable
          {existing.status !== 'Pending' ? ` (status: ${existing.status})` : ' (edit window has closed)'}.
          Only an admin can modify it now.
        </Alert>
      )}

      {/* Filter row: search + multi-category + multi-type + clear filters + clear cart */}
      <Box sx={{ mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Search products by name or code…"
          size="small"
          sx={{
            flex: 1, minWidth: 240, maxWidth: 380,
            '& .MuiOutlinedInput-root': { bgcolor: 'transparent' },
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search className="w-4 h-4 text-[#1F1F1F]" />
                </InputAdornment>
              ),
            },
          }}
        />

        <Autocomplete
          multiple
          disableCloseOnSelect
          size="small"
          options={categories}
          getOptionLabel={(opt) => opt.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          value={selectedCategoryValue}
          onChange={(_e, value) => setSelectedCategoryIds(value.map(v => v.id))}
          sx={{
            minWidth: 240, maxWidth: 400, flex: 1,
            '& .MuiOutlinedInput-root': { bgcolor: 'transparent' },
          }}
          renderInput={(params) => (
            <TextField {...params} label="Category" placeholder={selectedCategoryIds.length ? '' : 'All'} />
          )}
        />

        <Autocomplete
          multiple
          disableCloseOnSelect
          size="small"
          options={TYPE_OPTIONS as readonly string[]}
          value={selectedTypes}
          onChange={(_e, value) => setSelectedTypes(value)}
          sx={{
            minWidth: 200, maxWidth: 320, flex: 1,
            '& .MuiOutlinedInput-root': { bgcolor: 'transparent' },
          }}
          renderInput={(params) => (
            <TextField {...params} label="Type" placeholder={selectedTypes.length ? '' : 'All'} />
          )}
        />

        {(selectedCategoryIds.length > 0 || selectedTypes.length > 0 || searchInput) && (
          <Button
            variant="text"
            size="small"
            onClick={() => { setSelectedCategoryIds([]); setSelectedTypes([]); setSearchInput('') }}
            sx={{ textTransform: 'none', fontWeight: 600, color: '#1F1F1F' }}
          >
            Clear filters
          </Button>
        )}
        {distinctLines > 0 && (
          <Button
            variant="outlined"
            size="small"
            onClick={clearCart}
            sx={{
              textTransform: 'none', fontWeight: 600,
              borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFFFFF',
              '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
            }}
          >
            Clear cart
          </Button>
        )}
      </Box>

      {/* Side-by-side product tables.
          Two identical tables filled left → right so the user sees roughly 2x
          as many products without scrolling. Collapses to a single column on
          narrow screens (<md). All products load in one fetch (no pagination). */}
      {productsQuery.isLoading ? (
        <Box sx={{ p: 4, textAlign: 'center', color: '#1F1F1F99' }}>Loading products…</Box>
      ) : products.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 2, border: '2px dashed rgba(31,31,31,0.2)', color: '#1F1F1F99' }} elevation={0}>
          No products match. Try a different search or filter.
        </Paper>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            gap: 2,
            alignItems: 'flex-start',
          }}
        >
          <ProductsTable products={leftProducts} cart={cart} onSetQty={setQty} />
          {rightProducts.length > 0 && (
            <ProductsTable products={rightProducts} cart={cart} onSetQty={setQty} />
          )}
        </Box>
      )}

      {/* Sticky bottom cart-summary bar */}
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
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          <Badge badgeContent={distinctLines} color="primary" max={99}>
            <ShoppingCart className="w-5 h-5 text-[#1F1F1F]" />
          </Badge>
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ fontSize: isAdmin ? 13 : 15, fontWeight: 600, color: isAdmin ? '#1F1F1F99' : '#1F1F1F' }}>
              {cartCount} {cartCount === 1 ? 'unit' : 'units'} · {distinctLines} {distinctLines === 1 ? 'product' : 'products'}
            </Box>
            {/* Total amount is admin-only — shop users see qty/products only,
                so we don't blur their focus from the order-builder with a
                price subtotal. Admin needs the figure when editing a request
                on the shop's behalf. */}
            {isAdmin && (
              <Box sx={{ fontSize: 18, fontWeight: 700, color: '#1F1F1F' }}>{formatINR(cartTotal)}</Box>
            )}
          </Box>
        </Box>
        <Button
          variant="contained"
          size="medium"
          disabled={cart.size === 0 || (isEditMode && !editWindowOpen)}
          onClick={() => setReviewOpen(true)}
          sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}
        >
          Review & Submit
        </Button>
      </Paper>

      {/* Review dialog */}
      <Dialog
        open={reviewOpen}
        onClose={(_e, reason) => {
          if (reason === 'backdropClick' || activeMutation.isPending) return
          setReviewOpen(false)
        }}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3 } } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ShoppingCart className="w-5 h-5" />
            Review Your Request
          </Box>
          <IconButton size="small" onClick={() => setReviewOpen(false)} disabled={activeMutation.isPending}>
            <X className="w-4 h-4" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {cart.size === 0 ? (
            <Box sx={{ p: 2, textAlign: 'center', color: '#1F1F1F99' }}>
              Your cart is empty. Close this and pick some products.
            </Box>
          ) : (
            <>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#FCD835' }}>
                      <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11 }}>Product</TableCell>
                      <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, width: 70 }} align="right">Qty</TableCell>
                      {/* Subtotal column hidden for now — uncomment to bring it back.
                      <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, width: 110, whiteSpace: 'nowrap' }} align="right">Subtotal</TableCell>
                      */}
                      <TableCell sx={{ width: 40 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Array.from(cart.values()).map(line => {
                      const weightLabel = line.product.weightValue != null
                        ? `${line.product.weightValue} ${line.product.weightUnit ?? ''}`.trim()
                        : null
                      return (
                        <TableRow key={line.product.id}>
                          <TableCell>
                            <Box sx={{ fontWeight: 600, fontSize: 13 }}>
                              {line.product.code} — {line.product.name}
                              {weightLabel && (
                                <Box component="span" sx={{ ml: 0.75, fontSize: 11, fontWeight: 600, color: '#1F1F1F99', border: '1px solid rgba(31,31,31,0.2)', borderRadius: 0.75, px: 0.5, py: 0.15 }}>
                                  {weightLabel}
                                </Box>
                              )}
                            </Box>
                            {/* "₹ X.XX each" hint hidden along with the Subtotal column.
                            <Box sx={{ fontSize: 11, color: '#1F1F1F99' }}>{formatINR(line.product.mrp)} each</Box>
                            */}
                          </TableCell>
                          <TableCell align="right">{line.qty}</TableCell>
                          {/* Per-line subtotal hidden alongside the Subtotal column.
                          <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatINR(line.qty * line.product.mrp)}</TableCell>
                          */}
                          <TableCell align="right">
                            <IconButton size="small" color="error" onClick={() => setQty(line.product, 0)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow sx={{ bgcolor: '#FFF8DC' }}>
                      <TableCell sx={{ fontWeight: 700, color: '#1F1F1F' }}>
                        {distinctLines} {distinctLines === 1 ? 'product' : 'products'}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, color: '#1F1F1F', whiteSpace: 'nowrap' }}>
                        {cartCount} {cartCount === 1 ? 'unit' : 'units'}
                      </TableCell>
                      {/* Money total hidden for now — uncomment alongside the Subtotal column to bring it back.
                      <TableCell align="right" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatINR(cartTotal)}</TableCell>
                      */}
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              </TableContainer>

              <TextField
                label="Notes (optional)"
                value={notes}
                onChange={e => setNotes(e.target.value.slice(0, 500))}
                multiline
                minRows={2}
                size="small"
                fullWidth
                placeholder="Any special instructions for the godown…"
                slotProps={{ htmlInput: { maxLength: 500 } }}
                sx={{ mt: 2 }}
              />

              {localErr && <Alert severity="error" sx={{ mt: 2 }}>{localErr}</Alert>}
              {apiErrorMessage && <Alert severity="error" sx={{ mt: 2, whiteSpace: 'pre-line' }}>{apiErrorMessage}</Alert>}
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            onClick={() => setReviewOpen(false)}
            variant="outlined"
            color="secondary"
            disabled={activeMutation.isPending}
            sx={{ textTransform: 'none', fontWeight: 500 }}
          >
            Keep browsing
          </Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={cart.size === 0 || activeMutation.isPending || (isEditMode && !editWindowOpen)}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {activeMutation.isPending
              ? (isEditMode ? 'Updating…' : 'Submitting…')
              : isEditMode ? 'Update' : 'Submit'
              /* Amount-suffixed labels hidden for now — restore by swapping back:
                 isEditMode ? `Update (${formatINR(cartTotal)})` : `Submit (${formatINR(cartTotal)})`
              */}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ───────────────────────────────────────────────────────────────

function ProductsTable({
  products,
  cart,
  onSetQty,
}: {
  products: ProductDto[]
  cart: Map<string, CartLine>
  onSetQty: (product: ProductDto, qty: number) => void
}) {
  return (
    <Paper elevation={0} sx={{ borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFFFFF', overflow: 'hidden' }}>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#FCD835' }}>
              <TableCell sx={HEAD_SX}>Code</TableCell>
              <TableCell sx={HEAD_SX}>Product</TableCell>
              <TableCell sx={{ ...HEAD_SX, width: 90 }} align="right">Weight</TableCell>
              <TableCell sx={{ ...HEAD_SX, width: 90 }} align="right">MRP</TableCell>
              <TableCell sx={{ ...HEAD_SX, width: 100 }} align="center">Qty</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {products.map(p => (
              <ProductRow
                key={p.id}
                product={p}
                qty={cart.get(p.id)?.qty ?? 0}
                onSetQty={onSetQty}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  )
}

// React.memo + primitive `qty` prop means only the rows whose qty actually
// changes re-render. With 200 rows × controlled TextField this is the
// difference between an instant keystroke and a frozen dropdown.
//
// The qty input is a plain styled <input>, not MUI TextField, deliberately.
// TextField renders ~6 nested styled components; multiplying that by 200
// rows blew past the budget that keeps the Category dropdown responsive.
const ProductRow = memo(function ProductRow({
  product,
  qty,
  onSetQty,
}: {
  product: ProductDto
  qty: number
  onSetQty: (product: ProductDto, qty: number) => void
}) {
  const inCart = qty > 0
  return (
    <TableRow hover sx={inCart ? { bgcolor: '#FFFBE6' } : undefined}>
      <TableCell sx={{ fontSize: 12, color: '#1F1F1F99' }}>{product.code}</TableCell>
      <TableCell sx={{ fontWeight: 600 }}>{product.name}</TableCell>
      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
        {product.weightValue != null
          ? `${product.weightValue} ${product.weightUnit ?? ''}`.trim()
          : <span className="text-[#1F1F1F]/40">—</span>}
      </TableCell>
      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
        {formatINR(Number(product.mrp))}
      </TableCell>
      <TableCell align="center" sx={{ py: 0.5 }}>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={1_000_000}
          value={qty === 0 ? '' : qty}
          placeholder="0"
          onChange={e => {
            const v = e.target.value
            if (v === '') { onSetQty(product, 0); return }
            const n = parseInt(v, 10)
            if (!Number.isNaN(n) && n >= 0) onSetQty(product, n)
          }}
          onKeyDown={e => { if (['e', 'E', '+', '-', '.', ','].includes(e.key)) e.preventDefault() }}
          className="qty-input"
          style={{
            backgroundColor: inCart ? '#FFF8DC' : '#FFFFFF',
            borderColor:     inCart ? '#1F1F1F' : 'rgba(31,31,31,0.3)',
          }}
        />
      </TableCell>
    </TableRow>
  )
})

const HEAD_SX = {
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  fontSize: 11,
}
