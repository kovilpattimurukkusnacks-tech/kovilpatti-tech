import { Fragment, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Trash2, ArrowLeft, ShoppingCart, X, Search } from 'lucide-react'
import {
  Alert, Autocomplete, Badge, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import { useApp } from '../../context/AppContext'
import { useProducts } from '../../hooks/useProducts'
import { useCategories } from '../../hooks/useCategories'
import {
  useCreateStockRequest, useUpdateStockRequest, useStockRequest,
  useShopDraft, useSaveShopDraft, useDeleteShopDraft,
} from '../../hooks/useStockRequests'
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
import { UnsavedChangesDialog } from '../../components/UnsavedChangesDialog'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import type { ProductDto } from '../../api/products/types'
import { ValidationError } from '../../api/errors'
import { formatINR } from '../../utils/format'
import { formatIstTime } from '../../utils/formatDate'

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

  // Drafts only apply to the shop user's new-request flow. Disabled for:
  //   • edit mode (we're already working on a real request)
  //   • admin (admin doesn't have a shop, so no draft to load/save)
  const draftEnabled = !isEditMode && !isAdmin
  const draftQuery     = useShopDraft({ enabled: draftEnabled })
  const saveDraftMutation   = useSaveShopDraft()
  const deleteDraftMutation = useDeleteShopDraft()
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null)

  // Browse / filter state — category is a SINGLE-select (one category at a
  // time, per client feedback). Type stays multi-select.
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)
  // One-shot guard: the first category (alphabetical) is auto-selected the
  // FIRST time the categories list loads. We don't re-apply after that — if
  // the user clears the filter to see all products, we honour that intent.
  const [categoryAutoSeeded, setCategoryAutoSeeded] = useState(false)
  // Set of category IDs the user has at least *seen* in this session by
  // selecting in the dropdown (or via the auto-seed default). Drives the
  // Review & Submit gate: client wants the user to have visited every
  // category before they can submit, even if they don't add products from
  // each one. Monotonic — once visited, never un-marked, so clearing the
  // filter doesn't penalise the user.
  const [visitedCategoryIds, setVisitedCategoryIds] = useState<Set<number>>(new Set())
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput, 300)

  const categoriesQuery = useCategories()

  // Auto-select the alphabetically-first category as the default filter on
  // initial mount (covers both new-request and edit modes). Sorting explicitly
  // here — useCategories doesn't guarantee server-side ordering.
  //
  // The auto-seeded category counts as "visited" — the user loaded the page
  // and saw it immediately, no click required.
  useEffect(() => {
    if (categoryAutoSeeded) return
    const cats = categoriesQuery.data
    if (!cats || cats.length === 0) return
    const first = [...cats].sort((a, b) => a.name.localeCompare(b.name))[0]
    setSelectedCategoryId(first.id)
    setVisitedCategoryIds(prev => prev.has(first.id) ? prev : new Set(prev).add(first.id))
    setCategoryAutoSeeded(true)
  }, [categoriesQuery.data, categoryAutoSeeded])
  const productsQuery = useProducts({
    // useProducts accepts an array — wrap the single selection.
    categoryIds: selectedCategoryId != null ? [selectedCategoryId] : undefined,
    types:       selectedTypes.length ? selectedTypes : undefined,
    search:      debouncedSearch.trim() || undefined,
    page:        1,
    pageSize:    FETCH_ALL_PAGE_SIZE,
  })

  // Type filter options — mirrors the type dropdown in the Add Product form
  // (pages/Products.tsx). Keep these in sync if a new type is ever added.
  const TYPE_OPTIONS = ['pack', 'jar'] as const

  // Cart state — Map keyed by productId so add/update/remove is O(1).
  // Persists across category / type / search / page changes (intentionally).
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map())
  const [notes, setNotes] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)
  const [seeded, setSeeded] = useState(false)
  // True when the cart / notes have changed since the last successful save
  // (or since the cart was seeded from a saved draft). Drives the Save as
  // Draft button's disabled state so a user can't spam-save the same data.
  const [isDraftDirty, setIsDraftDirty] = useState(false)

  // In edit mode, seed cart + notes from the existing request once it loads.
  // Items contain enough info (id, code, name, unitPrice) to display the cart
  // without needing the full ProductDto.
  //
  // In new-request mode, the same one-shot seed runs against the shop user's
  // saved draft (if any) — so closing the tab and coming back resumes the
  // in-progress cart silently. The `seeded` flag fires exactly once, whichever
  // source wins; subsequent draft refetches don't overwrite live cart edits.
  useEffect(() => {
    if (seeded) return
    const source = isEditMode ? existing : draftQuery.data
    if (!source) return

    const map = new Map<string, CartLine>()
    for (const it of source.items ?? []) {
      const stub: ProductDto = {
        id: it.productId,
        code: it.productCode,
        name: it.productName,
        mrp: it.unitPrice,
        // Carry weight forward from the snapshotted item so seeded rows
        // still display the pack size in the review dialog.
        weightValue: it.weightValue,
        weightUnit: it.weightUnit,
        // Category name carried over so the cart-review grouping (and any
        // future category-aware UI) works on seeded carts.
        categoryId: 0,
        categoryName: it.categoryName,
        type: '',
        purchasePrice: null,
        gst: null,
        active: true,
      }
      map.set(it.productId, { product: stub, qty: it.requestedQty })
    }
    setCart(map)
    setNotes(source.notes ?? '')
    setSeeded(true)
  }, [isEditMode, existing, draftQuery.data, seeded])

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

  // Memoized Autocomplete value — stable reference unless the selection
  // changes, otherwise MUI's option-equality scan reruns every render.
  const selectedCategoryValue = useMemo(
    () => categories.find(c => c.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId],
  )

  // The product list re-renders into ~200 rows when filters change. That work
  // is heavy enough to block the filter Autocompletes from responding to
  // clicks. useDeferredValue lets React paint the urgent updates (dropdown
  // close, chip added) at high priority and re-renders the big table at
  // low priority, keeping the UI snappy.
  const deferredProducts = useDeferredValue(products)

  // Group by pack weight, then split the GROUPS across the two columns so
  // each weight section stays intact (left column = "100 g" group whole,
  // right column = "200 g" group whole). Fills left until it has ≥ half the
  // products by count, then sends the rest right — keeps the columns
  // visually balanced even when group sizes are uneven.
  const [leftGroups, rightGroups] = useMemo(() => {
    const all = groupProductsByWeight(deferredProducts)
    const total = deferredProducts.length
    const half  = Math.ceil(total / 2)
    const left:  ReturnType<typeof groupProductsByWeight> = []
    const right: ReturnType<typeof groupProductsByWeight> = []
    let leftCount = 0
    for (const g of all) {
      if (leftCount < half) {
        left.push(g)
        leftCount += g.items.length
      } else {
        right.push(g)
      }
    }
    return [left, right] as const
  }, [deferredProducts])

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

  // Unsaved-changes guard — fires when the user tries to leave the page
  // (in-app nav, refresh, back, tab close) while the draft is dirty.
  // submittingRef bypasses the guard during legitimate Submit/Update flows
  // where we're navigating away on purpose. Set synchronously inside the
  // handler before navigate() so the blocker callback sees it immediately.
  const submittingRef = useRef(false)
  const guard = useUnsavedChangesGuard(
    () => !submittingRef.current && isDraftDirty,
  )

  // Auto-save plumbing. `changeCountRef` increments on every user-driven
  // change (cart edit, notes typing). When the auto-save mutation starts it
  // captures the count; on success it only marks the draft clean if the
  // count hasn't grown since — that way a change made WHILE a save is
  // in-flight doesn't get wrongly cleared by the save's onSuccess.
  const changeCountRef = useRef(0)

  // Auto-save the draft 1.5s after the user stops editing. Cleanup on each
  // re-run cancels the pending timer, effectively debouncing — keep typing,
  // no save; pause 1.5s, save fires. Only active in the new-request flow
  // (drafts enabled) and when there's something to save.
  useEffect(() => {
    if (!draftEnabled || !isDraftDirty || cart.size === 0) return

    const timer = setTimeout(() => {
      const startCount = changeCountRef.current
      const items = Array.from(cart.values()).map(l => ({
        productId: l.product.id,
        requestedQty: l.qty,
      }))
      saveDraftMutation.mutate(
        { notes: notes.trim() || undefined, items },
        {
          onSuccess: () => {
            setDraftSavedAt(new Date())
            // Only clear the dirty flag if the user hasn't typed anything
            // new since this save started — otherwise we'd lose the
            // beforeunload/in-app-nav guard for those in-flight changes.
            if (changeCountRef.current === startCount) {
              setIsDraftDirty(false)
            }
          },
          // onError: silent. The button stays in "Save as Draft" state so
          // the user can retry manually; the apiErrorMessage banner near
          // the cart review dialog surfaces the BE error if relevant.
        },
      )
    }, 1500)

    return () => clearTimeout(timer)
    // saveDraftMutation deliberately omitted from deps — its identity changes
    // on every render, which would reset the debounce timer on every keystroke.
    // We rely on the closure capturing the latest mutation at effect-fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftEnabled, isDraftDirty, cart, notes])

  // Review & Submit gate — shop user (new mode only) must have visited every
  // category before submitting. Edit-mode and admin-acting-on-shop bypass:
  // they're working on an already-decided request and shouldn't have to
  // re-browse categories. If categories list is empty (or still loading),
  // the gate is open (nothing to visit).
  //
  // visitedCount counts only CURRENT categories that are in the visited set —
  // protects against a stale entry (e.g. a category that existed earlier in
  // the session but has since been deleted) artificially passing the gate.
  const totalCategories = categories.length
  const visitedCount = useMemo(
    () => categories.filter(c => visitedCategoryIds.has(c.id)).length,
    [categories, visitedCategoryIds],
  )
  const allCategoriesVisited = totalCategories === 0 || visitedCount >= totalCategories
  const reviewGate           = !isEditMode && !isAdmin && !allCategoriesVisited
  const categoriesRemaining  = Math.max(0, totalCategories - visitedCount)

  // Cart contents grouped by category → weight, matching the request detail
  // and picklist screens so the user sees a consistent layout everywhere.
  const groupedCart = useMemo(
    () => groupByCategoryWeight(
      Array.from(cart.values()),
      line => ({
        category:    line.product.categoryName,
        weightValue: line.product.weightValue,
        weightUnit:  line.product.weightUnit,
      }),
    ),
    [cart],
  )

  // Stable identity across renders so memoized ProductRow children don't all
  // re-render when the cart changes. Uses functional setCart so it doesn't
  // need `cart` in its closure.
  //
  // `setSeeded(true)` here locks out the draft / edit-mode auto-seed effect:
  // once the user touches the cart, their interaction wins even if the
  // server-side draft data arrives later in this same render cycle.
  //
  // `setIsDraftDirty(true)` marks the draft as having unsaved changes,
  // re-enabling the Save as Draft button.
  const setQty = useCallback((product: ProductDto, qty: number) => {
    setSeeded(true)
    setIsDraftDirty(true)
    changeCountRef.current += 1
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
        // Submission is itself a "save" — flag the guard so the upcoming
        // navigate() doesn't trip the unsaved-changes modal.
        submittingRef.current = true
        navigate(isAdmin ? `/admin/requests/${editId}` : `/shop/requests/${editId}`)
      } else {
        const res = await createMutation.mutateAsync({
          notes: notes.trim() || undefined,
          items,
        })
        submittingRef.current = true
        navigate(`/shop/requests/${res.id}`)
      }
    } catch {
      // shown via apiErrorMessage below
    }
  }

  /**
   * Save the current cart as the shop's draft (or replace the existing one).
   * BE enforces at-most-one-draft-per-shop via partial unique index; the
   * upsert SP handles the create-vs-update branch atomically.
   *
   * On success we mark the draft as "clean" so the Save button greys out
   * until the user makes another change.
   */
  const handleSaveDraft = async () => {
    setLocalErr(null)
    if (cart.size === 0) {
      setLocalErr('Add at least one product before saving a draft.')
      return
    }
    const startCount = changeCountRef.current
    const items = Array.from(cart.values()).map(l => ({
      productId: l.product.id,
      requestedQty: l.qty,
    }))
    try {
      await saveDraftMutation.mutateAsync({
        notes: notes.trim() || undefined,
        items,
      })
      setDraftSavedAt(new Date())
      // Only mark clean if nothing changed while the save was in flight —
      // otherwise we'd silently lose the dirty state for those edits.
      if (changeCountRef.current === startCount) {
        setIsDraftDirty(false)
      }
    } catch {
      // shown via apiErrorMessage below
    }
  }

  /**
   * Explicit discard — clears the saved draft on the BE and wipes the
   * in-memory cart. Independent from Clear cart, which is purely local.
   */
  const handleDiscardDraft = async () => {
    try {
      await deleteDraftMutation.mutateAsync()
      clearCart()
      setDraftSavedAt(null)
      setIsDraftDirty(false)
    } catch {
      // shown via apiErrorMessage below
    }
  }

  // Surface whichever mutation last errored to the user. Submit/Update take
  // precedence in edit mode; in new mode draft mutations also count.
  const activeMutation = isEditMode
    ? updateMutation
    : (saveDraftMutation.error
        ? saveDraftMutation
        : deleteDraftMutation.error
          ? deleteDraftMutation
          : createMutation)

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

      {/* Filter row: search + single-category + multi-type + clear filters + clear cart */}
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
          size="small"
          options={categories}
          getOptionLabel={(opt) => opt.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          value={selectedCategoryValue}
          onChange={(_e, value) => {
            setSelectedCategoryId(value ? value.id : null)
            // Mark the category as visited so the Review & Submit gate
            // progresses. Clearing the filter (value=null) doesn't un-visit.
            if (value && !visitedCategoryIds.has(value.id)) {
              setVisitedCategoryIds(prev => new Set(prev).add(value.id))
            }
          }}
          sx={{
            minWidth: 240, maxWidth: 360, flex: 1,
            '& .MuiOutlinedInput-root': { bgcolor: 'transparent' },
          }}
          renderInput={(params) => (
            <TextField {...params} label="Category" placeholder={selectedCategoryValue ? '' : 'All'} />
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

        {(selectedCategoryId != null || selectedTypes.length > 0 || searchInput) && (
          <Button
            variant="text"
            size="small"
            onClick={() => { setSelectedCategoryId(null); setSelectedTypes([]); setSearchInput('') }}
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

      {/* Side-by-side product tables, each grouped by pack weight.
          Whole weight groups stay intact within one column — never split a
          group across the two tables. Collapses to a single column on narrow
          screens (<md). All products load in one fetch (no pagination). */}
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
          <ProductsTable groups={leftGroups} cart={cart} onSetQty={setQty} />
          {rightGroups.length > 0 && (
            <ProductsTable groups={rightGroups} cart={cart} onSetQty={setQty} />
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
            {/* "Draft saved at HH:mm" indicator — only when a save has just
                happened in this session, or when the cart was seeded from
                a previously saved draft. */}
            {draftEnabled && (draftSavedAt || draftQuery.data) && (
              <Box sx={{ fontSize: 11, color: '#1F1F1F99', mt: 0.25 }}>
                Draft saved {draftSavedAt
                  ? `at ${formatIstTime(draftSavedAt)}`
                  : ''}
              </Box>
            )}
            {/* Visit-all-categories progress hint — only while the gate is
                still blocking submit. Once everything's visited, the hint
                disappears and the button enables. */}
            {reviewGate && (
              <Box sx={{ fontSize: 11, color: '#C62828', mt: 0.25, fontWeight: 600 }}>
                Visit all categories first · {visitedCount}/{totalCategories} done
                · {categoriesRemaining} to go
              </Box>
            )}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {/* Discard Draft — only shown when a draft has been previously
              saved. Hidden in edit mode (no draft concept) and for admin. */}
          {draftEnabled && draftQuery.data && (
            <Button
              variant="outlined"
              size="medium"
              onClick={handleDiscardDraft}
              disabled={deleteDraftMutation.isPending}
              sx={{
                textTransform: 'none', fontWeight: 600,
                borderColor: '#C62828', color: '#C62828',
                '&:hover': { borderColor: '#C62828', bgcolor: 'rgba(198,40,40,0.05)' },
              }}
            >
              Discard Draft
            </Button>
          )}
          {/* Save as Draft — only on the new-request flow (not edit, not
              admin). Disabled when nothing's pending to save: cart empty,
              save already in flight, OR draft hasn't changed since the
              last save. The label reflects state so the user knows
              whether the click did anything. */}
          {draftEnabled && (
            <Button
              variant="outlined"
              size="medium"
              disabled={cart.size === 0 || saveDraftMutation.isPending || !isDraftDirty}
              onClick={handleSaveDraft}
              title={!isDraftDirty && cart.size > 0 ? 'Already saved — make a change to save again' : undefined}
              sx={{
                textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap',
                borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFFFFF',
                '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
              }}
            >
              {saveDraftMutation.isPending
                ? 'Saving…'
                : !isDraftDirty && cart.size > 0
                  ? 'Saved'
                  : 'Save as Draft'}
            </Button>
          )}
          <Button
            variant="contained"
            size="medium"
            disabled={cart.size === 0 || (isEditMode && !editWindowOpen) || reviewGate}
            onClick={() => setReviewOpen(true)}
            title={reviewGate
              ? `Browse every category first — ${categoriesRemaining} still to visit`
              : undefined}
            sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}
          >
            Review & Submit
          </Button>
        </Box>
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
              {/* One card per category — matches the request detail / picklist
                  layout so the user sees a consistent grouping everywhere. */}
              {groupedCart.map(catGroup => (
                <Paper
                  key={catGroup.category}
                  elevation={0}
                  sx={{ mb: 1.5, borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFFFFF', overflow: 'hidden' }}
                >
                  <Box
                    sx={{
                      bgcolor: '#FCD835',
                      borderBottom: '2px solid #1F1F1F',
                      px: 1.5,
                      py: 0.75,
                      fontWeight: 700,
                      fontSize: 12,
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
                                colSpan={3}
                                sx={{
                                  bgcolor: '#FFFFFF',
                                  pl: 1.5,
                                  pt: wIdx === 0 ? 1 : 2,
                                  pb: 0.25,
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
                            {wg.items.map(line => (
                              <TableRow key={line.product.id}>
                                <TableCell sx={{ pl: 2.5, py: 0.75 }}>
                                  <Box sx={{ fontWeight: 600, fontSize: 13 }}>{line.product.name}</Box>
                                </TableCell>
                                <TableCell align="right" sx={{ py: 0.75, width: 60 }}>{line.qty}</TableCell>
                                <TableCell align="right" sx={{ py: 0.5, width: 40 }}>
                                  <IconButton size="small" color="error" onClick={() => setQty(line.product, 0)}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </IconButton>
                                </TableCell>
                              </TableRow>
                            ))}
                          </Fragment>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              ))}

              {/* Grand-totals strip — single line below all cards, no per-card
                  totals because the user wants a single overall summary. */}
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  bgcolor: '#FFF8DC',
                  border: '1px solid #1F1F1F',
                  borderRadius: 1,
                  px: 1.5,
                  py: 1,
                  mb: 0.5,
                }}
              >
                <Box sx={{ fontWeight: 700, fontSize: 13 }}>
                  {distinctLines} {distinctLines === 1 ? 'product' : 'products'}
                </Box>
                <Box sx={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>
                  {cartCount} {cartCount === 1 ? 'unit' : 'units'}
                </Box>
              </Box>

              <TextField
                label="Notes (optional)"
                value={notes}
                onChange={e => {
                  setNotes(e.target.value.slice(0, 500))
                  setIsDraftDirty(true)
                  changeCountRef.current += 1
                }}
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

      {/* Unsaved-changes guard modal. Driven by `useUnsavedChangesGuard`'s
          blocker. "Save as Draft" option is offered only in the new-request
          flow where drafts apply; edit mode and admin paths get a plain
          Discard / Stay choice. */}
      <UnsavedChangesDialog
        open={guard.state === 'blocked'}
        onSaveDraft={draftEnabled
          ? async () => {
              if (cart.size === 0) {
                throw new Error('Add at least one product before saving a draft.')
              }
              const items = Array.from(cart.values()).map(l => ({
                productId: l.product.id,
                requestedQty: l.qty,
              }))
              await saveDraftMutation.mutateAsync({
                notes: notes.trim() || undefined,
                items,
              })
              setDraftSavedAt(new Date())
              setIsDraftDirty(false)
              guard.proceed?.()
            }
          : undefined}
        onDiscard={() => guard.proceed?.()}
        onCancel={() => guard.reset?.()}
      />
    </Box>
  )
}

// ───────────────────────────────────────────────────────────────

// Group products by their pack weight so the table can render each weight
// (e.g. "100 g", "200 g", "1 kg") as a section heading with its products
// listed below. Products without a weight set fall into a "No weight"
// bucket rendered last. Sort:
//   1. unit alphabetically (so 'g' before 'kg' before 'l' before 'ml'),
//   2. then numeric value ascending within the same unit.
function groupProductsByWeight(products: ProductDto[]): { label: string; items: ProductDto[] }[] {
  const NONE = '__none__'
  const groups = new Map<string, ProductDto[]>()
  for (const p of products) {
    const key = (p.weightValue != null && p.weightUnit)
      ? `${p.weightValue}|${p.weightUnit}`
      : NONE
    const arr = groups.get(key)
    if (arr) arr.push(p)
    else groups.set(key, [p])
  }
  const keys = Array.from(groups.keys()).sort((a, b) => {
    if (a === NONE) return 1
    if (b === NONE) return -1
    const [av, au] = a.split('|')
    const [bv, bu] = b.split('|')
    if (au !== bu) return au.localeCompare(bu)
    return Number(av) - Number(bv)
  })
  return keys.map(k => {
    if (k === NONE) return { label: 'No weight specified', items: groups.get(k)! }
    const [v, u] = k.split('|')
    return { label: `${v} ${u}`, items: groups.get(k)! }
  })
}

function ProductsTable({
  groups,
  cart,
  onSetQty,
}: {
  groups: { label: string; items: ProductDto[] }[]
  cart: Map<string, CartLine>
  onSetQty: (product: ProductDto, qty: number) => void
}) {
  return (
    <Paper elevation={0} sx={{ borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFFFFF', overflow: 'hidden' }}>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#FCD835' }}>
              <TableCell sx={HEAD_SX}>Product</TableCell>
              <TableCell sx={{ ...HEAD_SX, width: 90 }} align="right">MRP</TableCell>
              <TableCell sx={{ ...HEAD_SX, width: 100 }} align="center">Qty</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {groups.map(group => (
              <Fragment key={group.label}>
                <TableRow>
                  <TableCell
                    colSpan={3}
                    align="center"
                    sx={{
                      bgcolor: '#FFF8DC',
                      borderTop: '2px solid #1F1F1F',
                      borderLeft: '4px solid #FCD835',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: 0.6,
                      fontSize: 12,
                      py: 1,
                    }}
                  >
                    {group.label}
                    <Box component="span" sx={{ ml: 1, color: '#1F1F1F99', fontWeight: 600 }}>
                      · {group.items.length} {group.items.length === 1 ? 'product' : 'products'}
                    </Box>
                  </TableCell>
                </TableRow>
                {group.items.map(p => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    qty={cart.get(p.id)?.qty ?? 0}
                    onSetQty={onSetQty}
                  />
                ))}
              </Fragment>
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
// rows blew past the budget that keeps the filter dropdown responsive.
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
      <TableCell sx={{ fontWeight: 600 }}>{product.name}</TableCell>
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
