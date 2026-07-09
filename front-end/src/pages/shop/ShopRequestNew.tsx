import { Fragment, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Trash2, ArrowLeft, ShoppingCart, X, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  Alert, Autocomplete, Badge, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import { useApp } from '../../context/AppContext'
import { useProducts } from '../../hooks/useProducts'
import { useCategories } from '../../hooks/useCategories'
import { useShops } from '../../hooks/useShops'
import {
  useCreateStockRequest, useUpdateStockRequest, useStockRequest,
  useShopDraft, useSaveShopDraft, useDeleteShopDraft,
  useCreateReturn,
} from '../../hooks/useStockRequests'
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
import { BASE_URL } from '../../api/config'
import { tokenStore } from '../../api/tokenStore'
import { UnsavedChangesDialog } from '../../components/UnsavedChangesDialog'
import ConfirmDialog from '../../components/ConfirmDialog'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import { buildRootLookup, sortRootCategoryNames } from '../../utils/rootCategoryPriority'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import type { ProductDto } from '../../api/products/types'
import type { CategoryDto } from '../../api/categories/types'
import { ValidationError } from '../../api/errors'
import { formatINR } from '../../utils/format'
import { formatIstTime } from '../../utils/formatDate'

type CartLine = {
  product: ProductDto
  qty: number
  /** Return-only partial-weight claim in grams. Undefined = full-pack
   *  return (existing behaviour). Set when the shop toggles a g/kg row
   *  to "partial" mode on the Return-review dialog. 02-Jul-2026. */
  returnWeightG?: number
}

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
  // 08-Jul-2026: admin can now open /admin/requests/new to raise a request
  // for a specific shop. Distinct branch from isEditMode — mode = "admin
  // creates for a shop". Shop-user create is the third branch (no shop
  // picker; forces currentUser.ShopId).
  const isAdminCreate = isAdmin && !isEditMode
  // Admin's chosen target shop for the new-request flow. Null until they
  // pick from the shop picker at the top of the review dialog.
  const [adminShopId, setAdminShopId] = useState<string | null>(null)
  // Admin lands here from /admin/requests/:id/edit, shop from /shop/requests/:id/edit
  const detailPath = isEditMode && editId
    ? (isAdmin ? `/admin/requests/${editId}` : `/shop/requests/${editId}`)
    : (isAdmin ? '/admin/requests' : '/shop/requests')

  const createMutation       = useCreateStockRequest()
  const updateMutation       = useUpdateStockRequest()
  // Return Stock — second submit option in the review dialog. The user
  // browses + carts the same way they would for an Order; only at the very
  // end do they decide "Submit" (Order) vs "Submit as Return". Keeps the
  // primary flow identical for semi-skilled users.
  const createReturnMutation = useCreateReturn()
  const existingQuery        = useStockRequest(editId)
  const existing             = existingQuery.data

  // Drafts (08-Jul-2026: admin drafts too). Rules:
  //   • edit mode → no drafts (we're already working on a real request).
  //   • shop user new-request → draft on their own shop.
  //   • admin new-request → draft on the picked shop only. If no shop is
  //     picked yet, drafts are disabled — nothing to key off of.
  // The `(shop_id, created_by)` partial unique index guarantees admin's
  // draft and the shop user's draft on the same shop don't collide.
  const draftShopId = isAdminCreate ? (adminShopId ?? undefined) : undefined
  const draftEnabled = !isEditMode && (!isAdmin || !!adminShopId)
  const draftQuery = useShopDraft(draftShopId, { enabled: draftEnabled })
  const saveDraftMutation   = useSaveShopDraft()
  const deleteDraftMutation = useDeleteShopDraft()
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null)
  // Shops list — only loaded when the admin-create branch actually needs
  // the picker. Cheap query; server returns the full shop list ordered
  // by code so the picker options are stable.
  const shopsQuery = useShops()
  const shops = isAdminCreate ? (shopsQuery.data ?? []) : []
  // Confirm-dialog gate for Discard Draft (29-Jun-2026 client follow-up).
  // Discarding wipes work that took the shop minutes to build — a single
  // accidental click on the sticky bottom bar shouldn't be enough.
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)

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

  // ── Nested-category awareness ───────────────────────────────
  // Shop user only sees ROOT categories in the dropdown — sub-cats and deeper
  // levels are an admin concern. Picking a root quietly broadens the product
  // filter to include every descendant, and the listing groups by sub-cat
  // (the heading-bars below the table render).
  const allCats  = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data])
  const rootCats = useMemo(() => allCats.filter(c => c.parentId == null), [allCats])

  // 29-Jun-2026 (client #16): hard-coded display order for the shop's
  // category dropdown. Matches the priority sequence the client wants
  // shop staff to browse in. Categories NOT in this list fall to the end
  // in alphabetical order (so a future admin-added category appears, just
  // after the curated set). Names match by normalised key (lowercase +
  // alphanumeric only) so minor variations in DB casing/spacing don't
  // break the order — e.g. "1 Kg Snacks", "1kg Snacks", "1KG Snacks"
  // all map to the same priority slot.
  const ROOT_CAT_PRIORITY: readonly string[] = [
    '1kg Snacks',
    'Packing Items',
    // 29-Jun-2026: DB root is named "Murukku & Snacks Packed" — keep this
    // entry in sync with the actual category name (admin can rename via
    // the Categories admin page; update both if it changes).
    'Murukku & Snacks Packed',
    'Sweets',
    'Biscuits',
    'Cakes',
    'Pickle/Thokku/Podi',
    'Healthy Foods',
    'Millet Foods',
    'Dry Fruit & Nuts',
    'Shop Needs',
  ]
  // Wrapped in a module-level helper so the .sort() callback below doesn't
  // re-normalise twice per comparison. Lookup is O(1) via Map.
  const priorityIndex = useMemo(() => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const m = new Map<string, number>()
    ROOT_CAT_PRIORITY.forEach((name, i) => m.set(norm(name), i))
    return { map: m, norm }
  // ROOT_CAT_PRIORITY is a module constant — deps empty is intentional.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const sortedRootCats = useMemo(() => {
    return [...rootCats].sort((a, b) => {
      const aIdx = priorityIndex.map.get(priorityIndex.norm(a.name)) ?? Infinity
      const bIdx = priorityIndex.map.get(priorityIndex.norm(b.name)) ?? Infinity
      if (aIdx !== bIdx) return aIdx - bIdx
      // Both unmapped → alphabetical tie-break.
      return a.name.localeCompare(b.name)
    })
  }, [rootCats, priorityIndex])

  // children-by-parent index — used to walk descendants of the selected root.
  const childrenByParent = useMemo(() => {
    const m = new Map<number, number[]>()
    for (const c of allCats) {
      if (c.parentId == null) continue
      const arr = m.get(c.parentId) ?? []
      arr.push(c.id)
      m.set(c.parentId, arr)
    }
    return m
  }, [allCats])

  // All category ids in the selected root's subtree (root id + every descendant).
  // null when nothing selected → BE returns all products.
  const filterCategoryIds = useMemo(() => {
    if (selectedCategoryId == null) return undefined
    const out: number[] = [selectedCategoryId]
    const stack: number[] = [selectedCategoryId]
    while (stack.length > 0) {
      const id = stack.pop()!
      for (const k of childrenByParent.get(id) ?? []) {
        out.push(k); stack.push(k)
      }
    }
    return out
  }, [selectedCategoryId, childrenByParent])

  // Auto-select the FIRST ROOT category (per the hard-coded priority order)
  // as the default filter on initial mount (covers both new-request and
  // edit modes). Auto-seeded category counts as "visited" — user loaded
  // the page and saw it.
  useEffect(() => {
    if (categoryAutoSeeded) return
    if (sortedRootCats.length === 0) return
    const first = sortedRootCats[0]
    setSelectedCategoryId(first.id)
    setVisitedCategoryIds(prev => prev.has(first.id) ? prev : new Set(prev).add(first.id))
    setCategoryAutoSeeded(true)
  }, [sortedRootCats, categoryAutoSeeded])

  // Prev / Next category pager (29-Jun-2026, client #16). Wired to the
  // sticky bottom bar so the shop user can flick between categories
  // without scrolling back to the top filter. Walks `sortedRootCats` in
  // the hard-coded priority order, marking each visited category so the
  // Review & Submit gate progresses naturally.
  const currentCatIndex = useMemo(
    () => sortedRootCats.findIndex(c => c.id === selectedCategoryId),
    [sortedRootCats, selectedCategoryId],
  )
  const hasPrevCat = currentCatIndex > 0
  const hasNextCat = currentCatIndex >= 0 && currentCatIndex < sortedRootCats.length - 1
  // Ref-based auto-focus: gotoCat flips the flag, then a useEffect
  // watches productsQuery.data (new-category products land here) and
  // focuses the first .qty-input once it renders. Replaces the earlier
  // rAF+setTimeout timer which raced against React-Query's fetch.
  // Initialised TRUE so the first product's qty grabs focus on page
  // mount too — restored 03-Jul-2026 after the gotoCat refactor
  // accidentally removed the mount-time focus behaviour.
  const pendingFocusRef = useRef(true)
  const gotoCat = useCallback((id: number) => {
    setSelectedCategoryId(id)
    setVisitedCategoryIds(prev => prev.has(id) ? prev : new Set(prev).add(id))
    window.scrollTo({ top: 0, behavior: 'smooth' })
    pendingFocusRef.current = true
  }, [])
  const gotoPrevCat = useCallback(() => {
    if (!hasPrevCat) return
    gotoCat(sortedRootCats[currentCatIndex - 1].id)
  }, [hasPrevCat, currentCatIndex, sortedRootCats, gotoCat])
  const gotoNextCat = useCallback(() => {
    if (!hasNextCat) return
    gotoCat(sortedRootCats[currentCatIndex + 1].id)
  }, [hasNextCat, currentCatIndex, sortedRootCats, gotoCat])
  const productsQuery = useProducts({
    // Broadened to the selected root's full subtree (root + descendants).
    categoryIds: filterCategoryIds,
    types:       selectedTypes.length ? selectedTypes : undefined,
    search:      debouncedSearch.trim() || undefined,
    page:        1,
    pageSize:    FETCH_ALL_PAGE_SIZE,
  })

  // Type filter options — mirrors the type dropdown in the Add Product form
  // (pages/Products.tsx). Keep these in sync if a new type is ever added.
  const TYPE_OPTIONS = ['pack', 'jar'] as const

  // sessionStorage key — per-shop scoped so multi-shop-account users
  // (rare, but possible) don't cross-hydrate. 03-Jul-2026: added as a
  // failsafe against F5 during typing — auto-save is debounced, and the
  // beforeunload keepalive fetch isn't 100% reliable across browsers.
  // sessionStorage is synchronous + survives refresh; we hydrate cart
  // from it on mount and clear it on submit.
  // sessionStorage key — per-user, per-shop. For shop users, shopId comes
  // from the auth claim. For admin-create, it's the picked shop; null
  // until they select one, so drafts and F5-hydration wait until then.
  // 08-Jul-2026: also namespaces by currentUser.id so admin's local
  // snapshot doesn't leak across roles on a shared browser profile.
  const draftScopeShopId = isAdminCreate ? adminShopId : (currentUser?.shopId ?? null)
  const draftLocalKey = draftScopeShopId && currentUser?.userId
    ? `shop-request-new-cart:${currentUser.userId}:${draftScopeShopId}`
    : null

  // Cart state — Map keyed by productId so add/update/remove is O(1).
  // Persists across category / type / search / page changes (intentionally).
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map())
  const [notes, setNotes] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)
  const [seeded, setSeeded] = useState(false)
  // Shop-declared "Special Request" flag (06-Jul-2026, client req). Toggled
  // on the review-submit step; when true the shop enters a free-text label
  // ("Diwali stock 2026") that rides on the request through inv approval →
  // vendor procurement → dispatch → shop receipt. Seeded from a resumed
  // draft or an edit-mode request; cleared on discard / submit-success.
  const [isSpecial, setIsSpecial] = useState(false)
  const [specialLabel, setSpecialLabel] = useState('')
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
      // 01-Jul-2026: skip inv-tagged items during shop edit-seed. Those
      // are the godown's post-approval additions; the shop can't modify
      // them (the SP protects them server-side too — fn_request_update
      // only deletes added_by='Shop' rows). If they leaked into the
      // shop's cart, the shop could accidentally change their qty and
      // the save would silently drop them.
      if ('addedBy' in it && it.addedBy === 'Inventory') continue
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
    // Hydrate Special-Request flag from the seeded source. Drafts and
    // edit-mode requests both carry isSpecial + specialLabel; unset flag
    // is treated as normal request.
    setIsSpecial(source.isSpecial ?? false)
    setSpecialLabel(source.specialLabel ?? '')
    setSeeded(true)
    // Flag genuine hydration so the auto-jump-to-first-unvisited effect
    // knows this cart is a resume, not fresh typing. Only set when the
    // source actually had items — an empty seed shouldn't trigger a jump.
    if (map.size > 0) hydratedFromSourceRef.current = true
  }, [isEditMode, existing, draftQuery.data, seeded])

  // 29-Jun-2026 bug fix: when a saved draft (or edit-mode request) seeds
  // the cart with items, also mark EVERY root category as "visited" so the
  // Submit gate doesn't reset to 1/11. The user already went through the
  // discovery phase to build that draft — having to re-click each
  // category just to unlock Submit is friction with no protective value.
  // Only fires when (a) we've seeded, (b) rootCats has loaded, and (c)
  // the seeded source actually had items. A bare empty-draft (none today
  // but defensive against future changes) doesn't trip this.
  // 03-Jul-2026: mark visited = every root category that has at least one
  // cart item under it. Runs on every cart/allCats change so both
  // sessionStorage-hydration AND user-driven navigation build up the
  // visit set precisely — not the "mark ALL 11" hammer from the seed
  // effect above. Fixes: Back → New Request lost the visit progress
  // because the sessionStorage path doesn't set seededFromSource.
  useEffect(() => {
    if (cart.size === 0) return
    if (allCats.length === 0 || rootCats.length === 0) return
    // Resolve leaf category name → owning root id. Walk allCats: for
    // each cart item, find its category, then follow parent chain to
    // the root, collect root ids.
    const byName = new Map<string, CategoryDto>()
    for (const c of allCats) if (!byName.has(c.name)) byName.set(c.name, c)
    const byId = new Map<number, CategoryDto>()
    for (const c of allCats) byId.set(c.id, c)
    const rootsForCart = new Set<number>()
    for (const line of cart.values()) {
      // Prefer categoryId (unique, precise) over categoryName (may
      // collide across roots). Stub products hydrated from sessionStorage
      // have categoryId=0 as a placeholder; those fall through to the
      // name lookup below.
      let cat: CategoryDto | undefined =
        (line.product.categoryId ? byId.get(line.product.categoryId) : undefined)
        ?? byName.get(line.product.categoryName)
      if (!cat) continue
      // Walk up parents until root.
      let guard = 0
      while (cat.parentId != null && guard++ < 20) {
        const parent = byId.get(cat.parentId)
        if (!parent) break
        cat = parent
      }
      rootsForCart.add(cat.id)
    }
    if (rootsForCart.size === 0) return
    setVisitedCategoryIds(prev => {
      // Union — never remove; only add roots that aren't already there.
      let changed = false
      const next = new Set(prev)
      for (const id of rootsForCart) if (!next.has(id)) { next.add(id); changed = true }
      return changed ? next : prev
    })
  }, [cart, allCats, rootCats])

  // 08-Jul-2026: reset cart when admin switches the shop picker. Without
  // this, if admin picks Shop A → carts 5 items → switches to Shop B, the
  // in-memory cart still shows Shop A's items — which would then autosave
  // to Shop B's draft slot on the next keystroke. Resetting `seeded` also
  // lets the newly-loaded Shop B draft hydrate the cart on its query.
  const prevAdminShopIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isAdminCreate) return
    // First render captures the initial state; only fire on actual switch.
    if (prevAdminShopIdRef.current === adminShopId) return
    // Skip the initial null → firstShop transition; that's just the
    // user picking their first shop, not a "switch". Reset only when
    // moving from one shop to another (both non-null and different).
    if (prevAdminShopIdRef.current !== null) {
      setCart(new Map())
      setNotes('')
      setIsSpecial(false)
      setSpecialLabel('')
      setVisitedCategoryIds(new Set())
      setIsDraftDirty(false)
      setSeeded(false)
      hydratedFromSourceRef.current = false
      hasAutoNavigatedRef.current = false
    }
    prevAdminShopIdRef.current = adminShopId
  }, [isAdminCreate, adminShopId])

  // Jump-to-first-unvisited on resume (03-Jul-2026). When the user comes
  // back to /new with a hydrated cart (from server draft OR sessionStorage)
  // and has already visited N categories, land them on the first unvisited
  // category so they don't have to click Prev/Next through work they've
  // already done. Fires exactly ONCE per mount — a useRef guard prevents
  // re-triggering as the user then legitimately walks through the rest.
  //
  // 06-Jul-2026: gated on `hydratedFromSourceRef` — the `seeded` flag can't
  // be used here because setQty flips it too (to lock out re-seeds during
  // live editing). Without a distinct flag, the first qty a fresh user
  // types was setting seeded=true → the derive-from-cart effect populated
  // visitedCategoryIds → this effect fired and jumped them to cat 2. Only
  // the actual draft-seed and sessionStorage-hydration paths flip the ref,
  // so typing can never trigger the jump.
  // True only when the cart was populated by an external source (edit-mode
  // request, saved server draft, or sessionStorage snapshot). Never flipped
  // by fresh user typing — distinct from `seeded` for exactly that reason.
  const hydratedFromSourceRef = useRef(false)
  const hasAutoNavigatedRef = useRef(false)
  useEffect(() => {
    if (hasAutoNavigatedRef.current) return
    if (isEditMode) return
    if (!hydratedFromSourceRef.current) return   // fresh session — never auto-jump
    if (sortedRootCats.length === 0) return
    // Only jump when the cart is HYDRATED — an empty cart means the user
    // is starting fresh; leaving them on cat 1 is correct.
    if (cart.size === 0) return
    // Also wait until the visit set has been populated by either the
    // sessionStorage restore or the derive-from-cart pass. If it's still
    // just the auto-select single entry, hydration hasn't settled yet.
    if (visitedCategoryIds.size === 0) return
    const firstUnvisited = sortedRootCats.find(c => !visitedCategoryIds.has(c.id))
    if (!firstUnvisited) return   // every category done — keep current selection
    hasAutoNavigatedRef.current = true
    setSelectedCategoryId(firstUnvisited.id)
    // Mark this as an implicit visit so the counter increments on landing.
    setVisitedCategoryIds(prev => prev.has(firstUnvisited.id) ? prev : new Set(prev).add(firstUnvisited.id))
    // Flag pendingFocusRef so the qty-input focus effect grabs the first
    // product's input on landing — matches Next-button behaviour.
    pendingFocusRef.current = true
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [sortedRootCats, visitedCategoryIds, cart, isEditMode])

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

  // Use `allCats` / `rootCats` directly — the legacy `categories` alias is
  // gone since every call site has been migrated to the right source.
  const products = productsQuery.data?.items ?? []

  // Auto-focus the first qty input of the freshly-loaded category after
  // a Prev/Next navigation. gotoCat flags pendingFocusRef; here we
  // fire on either (a) the selected category changing, or (b) products
  // finishing a fetch. Whichever completes second — once the DOM has
  // the new .qty-input rows — grabs focus. Both deps stay in the array
  // so a same-count cached-cat transition still triggers the focus.
  // 02-Jul-2026.
  useEffect(() => {
    if (!pendingFocusRef.current) return
    if (productsQuery.isFetching) return
    if (products.length === 0) return
    pendingFocusRef.current = false
    // Poll for the first .qty-input to appear + steal focus. React-Query's
    // cache-refresh timing vs React's commit vs the smooth scroll all
    // race in different orders on different runs, so a fixed rAF/timeout
    // isn't reliable. Loop up to 500 ms in 50-ms ticks; bail on first hit.
    let ticks = 0
    const tryFocus = () => {
      const first = document.querySelector<HTMLInputElement>('.qty-input')
      if (first) {
        first.focus()
        first.select()
        return
      }
      if (ticks++ < 10) setTimeout(tryFocus, 50)
    }
    tryFocus()
  }, [selectedCategoryId, productsQuery.isFetching, products.length])

  // Memoized Autocomplete value — stable reference unless the selection
  // changes, otherwise MUI's option-equality scan reruns every render.
  // Dropdown lists only roots, but the selected value can still resolve from
  // allCats so a deep-link / edit-mode pre-fill still finds its row.
  const selectedCategoryValue = useMemo(
    () => allCats.find(c => c.id === selectedCategoryId) ?? null,
    [allCats, selectedCategoryId],
  )

  // The product list re-renders into ~200 rows when filters change. That work
  // is heavy enough to block the filter Autocompletes from responding to
  // clicks. useDeferredValue lets React paint the urgent updates (dropdown
  // close, chip added) at high priority and re-renders the big table at
  // low priority, keeping the UI snappy.
  const deferredProducts = useDeferredValue(products)

  // Group by sub-category first (each root + its descendants become their own
  // section), then by weight within each sub-cat. The selected root is the
  // implicit context; sub-cat heading shows the path relative to that root
  // (e.g. "Spicy" or "Spicy > Kara Sev" when the user picked "Snacks").
  // When no root is selected, full path is shown so headings stay unambiguous.
  const catGroups = useMemo(
    () => groupProductsByCategoryThenWeight(
      deferredProducts,
      allCats,
      selectedCategoryId,
    ),
    [deferredProducts, allCats, selectedCategoryId],
  )

  // Split CAT GROUPS (not weight groups) across the two side-by-side columns
  // so each sub-cat heading + its weight sections stay intact. Greedy with
  // look-ahead: push a sub-cat to the LEFT only if doing so keeps left
  // within the half-mark; otherwise it spills to the right. This produces
  // a tight balance even when sub-cats are very uneven.
  //
  // Example: sub-cats of size [2, 8, 13] (total 23, half 12):
  //   • CHIPS(2)   → 2 ≤ 12 ✓ push left  (leftCount=2)
  //   • REGULAR(8) → 2+8=10 ≤ 12 ✓ push left  (leftCount=10)
  //   • SPECIAL(13)→ 10+13=23 > 12 ✗ push right
  // Result: LEFT=10, RIGHT=13 (imbalance 3). Previously the older guard
  // pushed everything left because `leftCount < half` was checked BEFORE
  // adding — so even the over-the-cliff one was accepted (29-Jun-2026,
  // client #16). Edge case: the very first sub-cat always lands on left
  // even if it alone exceeds half, so the page never renders an empty
  // left column.
  const [leftCatGroups, rightCatGroups] = useMemo(() => {
    const total = deferredProducts.length
    const half  = Math.ceil(total / 2)
    const left:  CategoryGroup[] = []
    const right: CategoryGroup[] = []
    let leftCount = 0
    for (const cg of catGroups) {
      const cgCount = cg.weightGroups.reduce((n, g) => n + g.items.length, 0)
      if (left.length === 0 || leftCount + cgCount <= half) {
        left.push(cg)
        leftCount += cgCount
      } else {
        right.push(cg)
      }
    }
    return [left, right] as const
  }, [catGroups, deferredProducts.length])

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
  //
  // 30-Jun-2026 — gated on `saveDraftMutation.isPending` so saves are
  // strictly serial. Previously, if a save took longer than 1.5s (Railway
  // cold-start, slow network) and the user kept editing / navigating, the
  // debounce could fire a SECOND mutation while the first was still in
  // flight. Two concurrent INSERTs into stock_requests then raced on the
  // `uq_stock_requests_one_draft_per_shop` partial unique index, the loser
  // threw a constraint violation, and that save's payload was silently
  // dropped — the bug the shop user hit when they rapid-pressed Next.
  //
  // With this guard: if a save is in flight, the timer effect skips. As
  // soon as the in-flight save settles (isPending → false), the effect
  // re-runs and — if the cart is still dirty — schedules a fresh 1.5s
  // timer with the latest state. No concurrency, latest-state-wins.
  useEffect(() => {
    if (!draftEnabled || !isDraftDirty || cart.size === 0) return
    if (saveDraftMutation.isPending) return

    // Debounce reduced 1500 → 400 ms on 03-Jul-2026 to shrink the "typed
    // but not saved" window. Beforeunload keepalive covers the residual
    // race, but a short debounce also means each keystroke persists
    // within half a second — a hard refresh mid-typing loses almost nothing.
    const timer = setTimeout(() => {
      const startCount = changeCountRef.current
      const items = Array.from(cart.values()).map(l => ({
        productId: l.product.id,
        requestedQty: l.qty,
      }))
      saveDraftMutation.mutate(
        {
          notes: notes.trim() || undefined,
          items,
          // Admin drafts carry the picked shop; shop-user submit omits
          // it (BE reads shop_id from the auth claim).
          ...(isAdminCreate && adminShopId ? { shopId: adminShopId } : {}),
        },
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
    }, 400)

    return () => clearTimeout(timer)
    // saveDraftMutation.mutate's identity changes per render so we capture
    // it via the closure at fire-time; isPending IS in deps because we
    // want the effect to re-run when the previous save lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftEnabled, isDraftDirty, cart, notes, saveDraftMutation.isPending])

  // sessionStorage failsafe (03-Jul-2026): mirror the cart + notes into
  // sessionStorage on every change. If the user hits F5 mid-typing —
  // before auto-save debounce fires OR before the beforeunload keepalive
  // completes — the cart survives the reload via sessionStorage. On
  // mount we hydrate from it (see the seed effect below). On successful
  // Submit + successful auto-save landing == server draft we clear it.
  useEffect(() => {
    if (!draftEnabled || !draftLocalKey) return
    // Do NOT clear on empty cart — this effect fires on initial mount
    // (before the hydration effect below has read the storage) and would
    // wipe a prior session's snapshot right when we need it. Cleared only
    // on successful Submit (see submit handlers). 03-Jul-2026.
    if (cart.size === 0) return
    const snapshot = {
      items: Array.from(cart.values()).map(l => ({
        productId: l.product.id,
        code:      l.product.code,
        name:      l.product.name,
        mrp:       l.product.mrp,
        weightValue: l.product.weightValue,
        weightUnit:  l.product.weightUnit,
        // 03-Jul-2026: also persist categoryId so derive-from-cart on the
        // rehydrated stub can look up the category directly instead of
        // falling back to name-collision-prone lookup.
        categoryId:   l.product.categoryId,
        categoryName: l.product.categoryName,
        qty: l.qty,
      })),
      notes,
      // Persist the visit-history so post-F5 the "N/11 categories done"
      // counter stays honest. Without this the user re-lands at 1/11
      // even though their cart already spans multiple categories.
      visitedCategoryIds: Array.from(visitedCategoryIds),
      // Persist the Special-Request declaration too, so an accidental F5
      // during / after the review dialog doesn't wipe the flag.
      isSpecial,
      specialLabel,
      savedAt: new Date().toISOString(),
    }
    try { sessionStorage.setItem(draftLocalKey, JSON.stringify(snapshot)) } catch { /* noop */ }
  }, [draftEnabled, draftLocalKey, cart, notes, visitedCategoryIds, isSpecial, specialLabel])

  // sessionStorage hydration (03-Jul-2026). Runs ONCE per mount if the
  // server-side draft hasn't landed yet. Prevents the "F5 lost my typing"
  // symptom regardless of whether auto-save / beforeunload actually made
  // it to the BE. Server draft (once it arrives) takes over via the
  // existing seed effect — if it happens to be MORE recent than the
  // sessionStorage snapshot, the map is rebuilt fresh from it.
  useEffect(() => {
    if (!draftEnabled || !draftLocalKey) return
    if (seeded) return
    // Bail ONLY when the server actually returned a draft — its seed will
    // win. If the server returned null (no draft) OR is still loading,
    // hydrate from sessionStorage so an F5 mid-typing doesn't reset the
    // cart just because the debounced auto-save hadn't reached the BE.
    if (draftQuery.data) return
    let raw: string | null = null
    try { raw = sessionStorage.getItem(draftLocalKey) } catch { /* noop */ }
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as {
        items: Array<{
          productId: string; code: string; name: string; mrp: number
          weightValue: number | null; weightUnit: string | null
          categoryId?: number    // 03-Jul-2026 addition, may be missing on older snapshots
          categoryName: string; qty: number
        }>
        notes: string
        visitedCategoryIds?: number[]
        // Special-Request declaration — added 06-Jul-2026. Optional so
        // snapshots written by earlier builds still parse cleanly (both
        // fall through to their setState defaults).
        isSpecial?: boolean
        specialLabel?: string | null
      }
      if (!parsed?.items?.length) return
      const map = new Map<string, CartLine>()
      for (const it of parsed.items) {
        const stub: ProductDto = {
          id: it.productId, code: it.code, name: it.name, mrp: it.mrp,
          weightValue: it.weightValue, weightUnit: it.weightUnit,
          // categoryId: real value when the snapshot was written by the
          // 03-Jul-2026+ code; 0 for legacy snapshots (derive-from-cart
          // falls back to categoryName lookup in that case).
          categoryId: it.categoryId ?? 0,
          categoryName: it.categoryName, type: '',
          purchasePrice: null, gst: null, active: true,
        }
        map.set(it.productId, { product: stub, qty: it.qty })
      }
      setCart(map)
      setNotes(parsed.notes ?? '')
      setIsSpecial(parsed.isSpecial ?? false)
      setSpecialLabel(parsed.specialLabel ?? '')
      // Restore the visit-history so the "N/11 categories done" counter
      // reflects what the user had already ticked off before the reload.
      // Falls back to derive-from-cart below if the snapshot is old-format
      // and doesn't include a visitedCategoryIds array.
      if (parsed.visitedCategoryIds?.length) {
        setVisitedCategoryIds(new Set(parsed.visitedCategoryIds))
      }
      setSeeded(true)
      // Real hydration → auto-jump is legit on this session.
      hydratedFromSourceRef.current = true
      setIsDraftDirty(true)  // still needs to sync to server
    } catch { /* corrupted JSON — bail */ }
    // Depends on draftQuery.data so that when the server responds with
    // null (no draft), this effect re-fires and hydrates from
    // sessionStorage. `seeded` guards against subsequent re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftEnabled, draftLocalKey, draftQuery.data])

  // Flush the draft on page unload / F5 refresh (02-Jul-2026 client bug).
  // Auto-save is debounced 1.5 s so a user typing qty + accidental F5
  // within that window loses the in-progress cart. The browser prompt from
  // useUnsavedChangesGuard warns them, but if they confirm the reload the
  // save still hasn't fired. `fetch({ keepalive: true })` guarantees the
  // POST completes even after the page starts unloading.
  //
  // beforeunload runs LAST (right before navigation), so we always have
  // the latest cart / notes in the closure. No debounce here — every
  // unload attempt fires a save if there are dirty changes.
  useEffect(() => {
    if (!draftEnabled) return
    const handler = () => {
      if (!isDraftDirty || cart.size === 0) return
      const items = Array.from(cart.values()).map(l => ({
        productId: l.product.id,
        requestedQty: l.qty,
      }))
      const token = tokenStore.get()
      if (!token) return
      try {
        fetch(`${BASE_URL}/api/stock-requests/draft`, {
          method: 'POST',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ notes: notes.trim() || undefined, items }),
        }).catch(() => { /* fire and forget */ })
      } catch { /* fire and forget */ }
    }
    window.addEventListener('beforeunload', handler)
    // visibilitychange = tab going background (Ctrl+Tab, minimising).
    // Belt-and-braces: iOS Safari sometimes suspends beforeunload but
    // still fires this. Fire the same save.
    const visHandler = () => { if (document.visibilityState === 'hidden') handler() }
    document.addEventListener('visibilitychange', visHandler)
    return () => {
      window.removeEventListener('beforeunload', handler)
      document.removeEventListener('visibilitychange', visHandler)
    }
  }, [draftEnabled, isDraftDirty, cart, notes])

  // Review & Submit gate — shop user (new mode only) must have visited every
  // category before submitting. Edit-mode and admin-acting-on-shop bypass:
  // they're working on an already-decided request and shouldn't have to
  // re-browse categories. If categories list is empty (or still loading),
  // the gate is open (nothing to visit).
  //
  // visitedCount counts only CURRENT roots that are in the visited set —
  // protects against a stale entry (e.g. a category that existed earlier in
  // the session but has since been deleted) artificially passing the gate.
  // The shop user only sees roots in the dropdown, so the gate is "visit
  // every root"; visiting a root implicitly covers its whole subtree.
  const totalCategories = rootCats.length
  const visitedCount = useMemo(
    () => rootCats.filter(c => visitedCategoryIds.has(c.id)).length,
    [rootCats, visitedCategoryIds],
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

  // 30-Jun-2026 — re-bucket cart's leaf-cat groups under their ROOT category
  // in the hard-coded priority order. Mirrors the request-detail / picklist
  // hierarchy so the shop user sees the same grouping on screen, in the
  // cart-review dialog, on the print picklist, and on the thermal slip.
  const groupedCartByRoot = useMemo(() => {
    const lookup = buildRootLookup(allCats)
    const byRoot = new Map<string, typeof groupedCart>()
    for (const cg of groupedCart) {
      const root = lookup(cg.category)
      const arr = byRoot.get(root)
      if (arr) arr.push(cg)
      else byRoot.set(root, [cg])
    }
    return sortRootCategoryNames(Array.from(byRoot.keys()))
      .map(root => {
        const children = byRoot.get(root)!
        const productCount = children.reduce(
          (sum, cg) => sum + cg.weightGroups.reduce((s, wg) => s + wg.items.length, 0),
          0,
        )
        return { root, children, productCount }
      })
  }, [groupedCart, allCats])

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
    setIsSpecial(false)
    setSpecialLabel('')
    setLocalErr(null)
  }

  const handleSubmit = async () => {
    setLocalErr(null)
    if (cart.size === 0) {
      setLocalErr('Add at least one product to the request.')
      return
    }
    // Admin-create branch requires the shop picker to be filled in.
    // Blocking here (not just at the Submit button's disabled) means a
    // keyboard user hitting Enter can't sneak past.
    if (isAdminCreate && !adminShopId) {
      setLocalErr('Pick a shop before submitting.')
      return
    }
    const items = Array.from(cart.values()).map(l => ({
      productId: l.product.id,
      requestedQty: l.qty,
    }))
    // Special-Request payload — only forward the label when the flag is
    // actually true (BE also guards this via chk_special_label_only_when_special).
    // Trim + null-empty so a whitespace-only label doesn't pollute the DB.
    const trimmedLabel = specialLabel.trim()
    const specialFields = isSpecial
      ? { isSpecial: true, specialLabel: trimmedLabel || null }
      : { isSpecial: false }
    try {
      if (isEditMode && editId) {
        await updateMutation.mutateAsync({
          id: editId,
          req: { notes: notes.trim() || undefined, items },
        })
        // Edit path doesn't touch the Special flag — the shop uses PATCH
        // /requests/{id}/special separately (SetSpecial hook) if they need
        // to change it. Keeps the update contract tight.
        // Submission is itself a "save" — flag the guard so the upcoming
        // navigate() doesn't trip the unsaved-changes modal.
        submittingRef.current = true
        if (draftLocalKey) { try { sessionStorage.removeItem(draftLocalKey) } catch { /* noop */ } }
        navigate(isAdmin ? `/admin/requests/${editId}` : `/shop/requests/${editId}`)
      } else {
        // Admin-create passes an explicit shopId (BE requires it for
        // admin callers). Shop-user submit omits the field; the BE
        // pins it to currentUser.ShopId server-side.
        const res = await createMutation.mutateAsync({
          notes: notes.trim() || undefined,
          items,
          ...specialFields,
          ...(isAdminCreate && adminShopId ? { shopId: adminShopId } : {}),
        })
        submittingRef.current = true
        if (draftLocalKey) { try { sessionStorage.removeItem(draftLocalKey) } catch { /* noop */ } }
        // Post-submit redirect (08-Jul-2026 client req): land on the LIST
        // page where the new request will surface — not the detail page.
        //   • Admin → All tab on the admin list.
        //   • Shop → Pending tab on the shop list.
        // AdminRequests reads ?preset= from the URL (defaults to 'all' if
        // unset). ShopRequests holds preset in local state; its initial
        // useState value is 'pending', so a fresh mount lands there.
        // Both cases: navigating to the list URL is enough.
        navigate(isAdminCreate ? '/admin/requests?preset=all' : '/shop/requests')
      }
    } catch {
      // shown via apiErrorMessage below
    }
  }

  /**
   * Second submit path on the Review & Submit dialog — converts the same cart
   * into a Return (items going back to the godown). Same cart items, same
   * notes; only the endpoint and the BE-side `request_type` differ. We don't
   * pass sourceRequestId in this minimal v1 — all Returns are "free-form".
   * When Phase 3 accounts goes live we'll add an optional source picker.
   *
   * Only shown in the new-request flow for shop users (hidden for edit mode
   * and admin — both work on existing rows, not new Returns).
   */
  // Return Stock click opens a dedicated config dialog where the shop
  // can flip any g/kg cart line to "Partial (weight)" mode and enter
  // grams to claim (damage claim; no physical goods movement).
  const [returnConfigOpen, setReturnConfigOpen] = useState(false)

  const handleSubmitAsReturn = async () => {
    setLocalErr(null)
    if (cart.size === 0) {
      setLocalErr('Add at least one product to return.')
      return
    }
    const items = Array.from(cart.values()).map(l => ({
      productId: l.product.id,
      requestedQty: l.qty,
      returnWeightG: l.returnWeightG,   // undefined → omitted from JSON
    }))
    try {
      const res = await createReturnMutation.mutateAsync({
        notes: notes.trim() || undefined,
        items,
      })
      submittingRef.current = true
      if (draftLocalKey) { try { sessionStorage.removeItem(draftLocalKey) } catch { /* noop */ } }
      navigate(`/shop/requests/${res.id}`)
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
        ...(isAdminCreate && adminShopId ? { shopId: adminShopId } : {}),
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
   * Gated behind a confirm dialog (see `discardConfirmOpen`) so a stray
   * click on the sticky bottom bar can't wipe minutes of work.
   */
  const handleDiscardDraft = async () => {
    try {
      // Admin's delete goes against the picked shop; shop-user's omits
      // (BE resolves via auth claim).
      await deleteDraftMutation.mutateAsync(isAdminCreate ? adminShopId ?? undefined : undefined)
      clearCart()
      setDraftSavedAt(null)
      setIsDraftDirty(false)
      // Also wipe the sessionStorage failsafe — otherwise an immediate
      // F5 re-hydrates the just-discarded cart from the local snapshot.
      // 03-Jul-2026.
      if (draftLocalKey) {
        try { sessionStorage.removeItem(draftLocalKey) } catch { /* noop */ }
      }
      setDiscardConfirmOpen(false)
    } catch {
      // shown via apiErrorMessage below — leave dialog open so user can retry
    }
  }

  // Surface whichever mutation last errored to the user. Submit/Update take
  // precedence in edit mode; otherwise draft mutations and the two submit
  // paths (create / createReturn) all count.
  const activeMutation = isEditMode
    ? updateMutation
    : createReturnMutation.error
      ? createReturnMutation
      : (saveDraftMutation.error
          ? saveDraftMutation
          : deleteDraftMutation.error
            ? deleteDraftMutation
            : createMutation)

  // Return Stock button visible only on the shop user's new-request flow —
  // edit mode and admin views don't get a Return path here.
  const showReturnButton = !isEditMode && !isAdmin

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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {/* Draft badge — surfaces whenever there's an unsent cart
                being auto-saved. Same amber/gold treatment as the
                dispatch-draft chip on the inventory side. 03-Jul-2026. */}
            {draftEnabled && cart.size > 0 && (
              <Chip
                label="Draft"
                size="small"
                variant="outlined"
                sx={{
                  borderColor: '#C28A00',
                  color: '#7C4A00',
                  bgcolor: '#FFF8E1',
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: 0.5,
                }}
              />
            )}
            <Button
              variant="outlined"
              startIcon={<ArrowLeft className="w-4 h-4" />}
              onClick={() => navigate(detailPath)}
              sx={{
                textTransform: 'none', fontWeight: 600,
                borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFF8E1',
                '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
              }}
            >
              Back
            </Button>
          </Box>
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

      {/* Admin-create shop picker (08-Jul-2026, moved from inside the
          Review dialog on 08-Jul-2026 evening). Admin picks the target
          shop UP-FRONT so:
            • auto-save has a shopId to key against (draftEnabled needs it).
            • the browsing UX is anchored to "you are ordering for Shop X".
          Card is amber-tinted so it stands out as the primary decision on
          this page. Filter row + product grid render below regardless,
          but nothing saves until this is picked. */}
      {isAdminCreate && (
        <Paper
          elevation={0}
          sx={{
            mb: 2, p: 1.5, borderRadius: 2,
            bgcolor: '#FFF8DC',
            border: `2px solid ${adminShopId ? '#C28A00' : '#E65100'}`,
            display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
          }}
        >
          <Box sx={{
            fontSize: 11, fontWeight: 800, textTransform: 'uppercase',
            letterSpacing: 0.5, color: '#7C4A00', minWidth: 100,
          }}>
            Raise for shop
          </Box>
          <Autocomplete
            size="small"
            options={shops}
            value={shops.find(s => s.id === adminShopId) ?? null}
            onChange={(_e, value) => setAdminShopId(value?.id ?? null)}
            getOptionLabel={s => `${s.code} · ${s.name}`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            sx={{ flex: 1, minWidth: 260, maxWidth: 480 }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={shopsQuery.isLoading ? 'Loading shops…' : 'Select a shop'}
                variant="outlined"
                // 08-Jul-2026: no pure white anywhere in this app — the
                // pale-yellow/cream family is the uniform palette. #FFFBE6
                // is the lightest cream + reads as a distinct input inside
                // the amber "Raise for shop" card.
                sx={{ bgcolor: '#FFFBE6', borderRadius: 1 }}
              />
            )}
          />
          {!adminShopId && (
            <Box sx={{ fontSize: 12, fontWeight: 700, color: '#E65100' }}>
              Required — nothing saves until you pick a shop.
            </Box>
          )}
        </Paper>
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
          // Shop user picks from ROOT categories only — sub-cats are an admin
          // concern. Picking a root broadens the product list to the whole
          // subtree (see filterCategoryIds). Options use the hard-coded
          // priority order (sortedRootCats), not alphabetical.
          options={sortedRootCats}
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
              borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFF8E1',
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
          <ProductsTable catGroups={leftCatGroups} cart={cart} onSetQty={setQty} onEnterAtEnd={gotoNextCat} />
          {rightCatGroups.length > 0 && (
            <ProductsTable catGroups={rightCatGroups} cart={cart} onSetQty={setQty} onEnterAtEnd={gotoNextCat} />
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
        {/* Category pager (29-Jun-2026, client #16). Sits between the
            cart info and the action buttons. Lets the user flick to the
            next/prev category in the hard-coded priority order without
            scrolling back to the top filter. Position counter
            (e.g. 3/11) gives orientation. Hidden when there's no current
            category or fewer than 2 sub-cats (no point pagering).
            Discard Draft moved into this center cluster on 29-Jun-2026
            so it sits well away from Review & Submit — same client raised
            an accidental-click risk when both reds were right-side. */}
        {(currentCatIndex >= 0 && sortedRootCats.length > 1) || (draftEnabled && draftQuery.data) ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            {currentCatIndex >= 0 && sortedRootCats.length > 1 && (
              <>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={gotoPrevCat}
                  // Also gated on productsQuery.isFetching so rapid clicks
                  // don't stack category-switches while the new category's
                  // products are still loading. 03-Jul-2026.
                  disabled={!hasPrevCat || productsQuery.isFetching}
                  startIcon={<ChevronLeft className="w-4 h-4" />}
                  sx={{
                    textTransform: 'none', fontWeight: 600,
                    borderColor: '#1F1F1F', color: '#1F1F1F',
                    '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
                    '&.Mui-disabled': { borderColor: 'rgba(31,31,31,0.2)', color: '#1F1F1F40' },
                  }}
                >
                  Prev
                </Button>
                <Box sx={{
                  fontSize: 11, fontWeight: 700, color: '#1F1F1F99', textAlign: 'center',
                  minWidth: 50, whiteSpace: 'nowrap', px: 0.5,
                }}>
                  {currentCatIndex + 1}/{sortedRootCats.length}
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={gotoNextCat}
                  // Also gated on productsQuery.isFetching so a spam-Next
                  // burst doesn't skip ahead while the previous category's
                  // products are still loading — categories then land
                  // out-of-order + the auto-focus lands nowhere. 03-Jul-2026.
                  disabled={!hasNextCat || productsQuery.isFetching}
                  endIcon={<ChevronRight className="w-4 h-4" />}
                  sx={{
                    textTransform: 'none', fontWeight: 600,
                    borderColor: '#1F1F1F', color: '#1F1F1F',
                    '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
                    '&.Mui-disabled': { borderColor: 'rgba(31,31,31,0.2)', color: '#1F1F1F40' },
                  }}
                >
                  Next
                </Button>
              </>
            )}
            {/* Discard Draft — only shown when a draft has been previously
                saved. Hidden in edit mode (no draft concept) and for admin.
                Clicking opens a confirm dialog (handleDiscardDraft fires
                only on confirm). ml:5 + a thin divider create deliberate
                breathing room from the Next button so a user reaching for
                Next doesn't graze Discard Draft (29-Jun-2026, second pass). */}
            {draftEnabled && draftQuery.data && (
              <>
                {currentCatIndex >= 0 && sortedRootCats.length > 1 && (
                  <Box
                    aria-hidden
                    sx={{
                      width: '1px',
                      height: 24,
                      bgcolor: 'rgba(31,31,31,0.18)',
                      ml: 4,
                      mr: 1,
                    }}
                  />
                )}
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setDiscardConfirmOpen(true)}
                  disabled={deleteDraftMutation.isPending}
                  sx={{
                    textTransform: 'none', fontWeight: 600,
                    borderColor: '#C62828', color: '#C62828',
                    '&:hover': { borderColor: '#C62828', bgcolor: 'rgba(198,40,40,0.05)' },
                  }}
                >
                  Discard Draft
                </Button>
              </>
            )}
          </Box>
        ) : null}

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
              {/* Admin-create shop picker moved to the top of the page
                  (08-Jul-2026 evening) so admin picks up-front and the
                  auto-save has a shopId to key against BEFORE the cart
                  builds. See the Paper block just below PageHeader. The
                  review dialog no longer needs its own picker — a small
                  read-only recap below lets the admin double-check the
                  target shop before Submit. */}
              {isAdminCreate && adminShopId && (
                <Box sx={{
                  mb: 2, px: 1.5, py: 1, borderRadius: 2,
                  bgcolor: '#FFF8DC', border: '1px solid #C28A00',
                  fontSize: 12, color: '#7C4A00',
                }}>
                  <strong>Raising for:</strong>{' '}
                  {(() => {
                    const s = shops.find(x => x.id === adminShopId)
                    return s ? `${s.code} · ${s.name}` : adminShopId
                  })()}
                </Box>
              )}

              {/* Two-level grouping: outer = ROOT category (1 KG SNACKS, etc.)
                  with an underline-style heading; inner = leaf-cat cards
                  (existing yellow banner + per-product rows). Mirrors the
                  request-detail / print hierarchy so the shop user sees
                  the same shape everywhere (30-Jun-2026). */}
              {groupedCartByRoot.map((rg, rgIdx) => (
                <Box key={rg.root} sx={{ mb: 2 }}>
                  <Box
                    sx={{
                      fontSize: 13,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: 0.6,
                      color: '#1F1F1F',
                      textAlign: 'center',
                      pb: 0.5,
                      mb: 1,
                      mt: rgIdx === 0 ? 0 : 0.5,
                      borderBottom: '2px solid #1F1F1F',
                    }}
                  >
                    {rg.root}
                    <Box component="span" sx={{ ml: 1, fontSize: 11, color: '#1F1F1F99', fontWeight: 600 }}>
                      · {rg.productCount} {rg.productCount === 1 ? 'product' : 'products'}
                    </Box>
                  </Box>
                  {rg.children.map(catGroup => (
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
                </Box>
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

              {/* Special Request toggle (06-Jul-2026, client req). Always
                  amber-highlighted whether on or off so the shop sees the
                  option every time they open Review — the client explicitly
                  asked for a persistent visual, not a subtle checkbox.
                  Only surfaces on the CREATE path — edit-mode changes to
                  the flag go through PATCH /special via useSetSpecial().
                  Hidden entirely in edit-mode so the shop can't half-toggle
                  the field and expect the update to carry it. */}
              {!isEditMode && (
                <Box sx={{ mt: 2 }}>
                  <Box
                    onClick={() => setIsSpecial(v => {
                      const next = !v
                      // Clear the label when turning the flag off — matches
                      // the DB constraint chk_special_label_only_when_special.
                      if (!next) setSpecialLabel('')
                      setIsDraftDirty(true)
                      return next
                    })}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click() } }}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.25,
                      px: 1.5,
                      py: 1,
                      borderRadius: 2,
                      cursor: 'pointer',
                      // Brighter palette (client feedback 06-Jul-2026): the
                      // earlier soft amber blended into the cream page. Bumped
                      // both states two shades up the Material orange scale so
                      // the toggle POPS in the review dialog whether on or off.
                      //   Off → #FFB74D (Material orange 300) w/ dark rim
                      //   On  → #FB8C00 (Material orange 600) w/ burnt-brown rim
                      // Text stays #7C4A00 for legibility on both states.
                      bgcolor: isSpecial ? '#FB8C00' : '#FFB74D',
                      border: `2px solid ${isSpecial ? '#7C4A00' : '#E65100'}`,
                      boxShadow: isSpecial
                        ? '0 2px 8px rgba(230, 81, 0, 0.35)'
                        : '0 1px 3px rgba(230, 81, 0, 0.25)',
                      transition: 'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
                      '&:hover': { bgcolor: isSpecial ? '#F57C00' : '#FFA726' },
                    }}
                  >
                    <Box
                      sx={{
                        width: 22, height: 22, borderRadius: '50%',
                        // Off → hollow white circle w/ brown rim (visible on
                        // the mid-amber bg). On → solid white circle w/ dark
                        // check, matching the white label text — reads as
                        // one high-contrast group against the deep orange.
                        bgcolor: '#FFFFFF',
                        border: `2px solid ${isSpecial ? '#3E2500' : '#7C4A00'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#3E2500', fontWeight: 800, fontSize: 13,
                      }}
                    >
                      {isSpecial ? '✓' : ''}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      {/* Text contrast (06-Jul-2026 follow-up): on the deeper
                          "on" orange, brown-on-amber loses too much contrast.
                          Switch to white on-state; keep dark brown on-off so
                          the label stays legible whichever state the button
                          is in. Sublabel drops to 85% opacity so it reads as
                          secondary without disappearing. */}
                      <Box sx={{
                        fontWeight: 800,
                        color: isSpecial ? '#FFFFFF' : '#3E2500',
                        fontSize: 14,
                        textShadow: isSpecial ? '0 1px 1px rgba(0,0,0,0.25)' : 'none',
                      }}>
                        Mark as Special Request
                      </Box>
                      <Box sx={{
                        fontSize: 11.5,
                        color: isSpecial ? 'rgba(255,255,255,0.92)' : '#3E2500',
                      }}>
                        Godown will procure from a vendor rather than pack from stock.
                      </Box>
                    </Box>
                  </Box>

                  {isSpecial && (
                    <TextField
                      label="Special Request name"
                      value={specialLabel}
                      onChange={e => {
                        setSpecialLabel(e.target.value.slice(0, 120))
                        setIsDraftDirty(true)
                      }}
                      size="small"
                      fullWidth
                      placeholder="e.g. Diwali stock 2026"
                      helperText="Optional — leave blank to use the default 'Special Request' label."
                      slotProps={{ htmlInput: { maxLength: 120 } }}
                      sx={{ mt: 1 }}
                    />
                  )}
                </Box>
              )}

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
        <DialogActions sx={{ p: 2, flexWrap: 'wrap', gap: 1 }}>
          {/* Return Stock — second submit path. Same cart, different endpoint
              (sends items BACK to the godown instead of forward). Red so it
              reads as a destructive / reverse action vs the primary Submit.
              Hidden in edit mode and for admin (they're not creating new
              returns from this screen). 29-Jun-2026: pinned to the LEFT
              corner via `mr: auto`, which pushes the other two buttons to
              the right edge — separates the reverse action from the
              forward actions so the user doesn't fat-finger it. */}
          {showReturnButton && (
            <Button
              // 02-Jul-2026: opens the Return-config dialog first so shop can
              // flip any g/kg line to a partial-weight damage claim. From
              // that dialog Submit calls handleSubmitAsReturn.
              onClick={() => setReturnConfigOpen(true)}
              variant="outlined"
              disabled={cart.size === 0 || activeMutation.isPending}
              sx={{
                textTransform: 'none', fontWeight: 700,
                borderColor: '#C62828', color: '#C62828', bgcolor: '#FFFFFF',
                '&:hover': { borderColor: '#C62828', bgcolor: 'rgba(198,40,40,0.08)' },
                mr: 'auto',
              }}
            >
              Return Stock
            </Button>
          )}

          <Button
            onClick={() => setReviewOpen(false)}
            variant="outlined"
            disabled={activeMutation.isPending}
            sx={{
              textTransform: 'none', fontWeight: 600,
              borderColor: '#1F1F1F', color: '#1F1F1F',
              '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
            }}
          >
            Keep browsing
          </Button>

          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={
              cart.size === 0
              || activeMutation.isPending
              || (isEditMode && !editWindowOpen)
              // Admin must pick a shop before Submit lights up.
              || (isAdminCreate && !adminShopId)
            }
            title={isAdminCreate && !adminShopId ? 'Pick a shop first' : undefined}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {activeMutation.isPending
              ? (isEditMode ? 'Updating…' : 'Submitting…')
              : isEditMode ? 'Update' : 'Submit'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Return-config dialog (02-Jul-2026). Opened when the shop clicks
          "Return Stock" in the review dialog. Lists every cart line + lets
          the shop flip any g/kg SKU to "Partial (weight)" mode and enter
          grams to claim — the damage-claim (B2) flow. Bookkeeping-only:
          no physical goods movement. Submit from here calls
          handleSubmitAsReturn with returnWeightG per affected line. */}
      <Dialog
        open={returnConfigOpen}
        onClose={(_e, reason) => {
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') return
          if (createReturnMutation.isPending) return
          setReturnConfigOpen(false)
        }}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3 } } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 700 }}>
          Return Stock — configure
          <IconButton size="small" onClick={() => setReturnConfigOpen(false)} disabled={createReturnMutation.isPending}>
            <X className="w-4 h-4" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ fontSize: 12, color: '#1F1F1F99', mb: 1.5 }}>
            Full pack returns credit the whole MRP. For a partial damage claim on a g/kg product,
            switch to <strong>Partial</strong> and enter the grams. Godown will review before crediting.
          </Box>
          <Box sx={{ maxHeight: 380, overflowY: 'auto', border: '1px solid rgba(31,31,31,0.15)', borderRadius: 1 }}>
            {Array.from(cart.values()).map(line => {
              const p = line.product
              const unit = p.weightUnit ?? ''
              const isWeightBased = (unit === 'g' || unit === 'kg') && (p.weightValue ?? 0) > 0
              const packG = isWeightBased ? Number(p.weightValue) * (unit === 'kg' ? 1000 : 1) : 0
              const maxG  = packG * line.qty
              const isPartial = line.returnWeightG != null
              const credit = isPartial && packG > 0
                ? (line.returnWeightG! / packG) * Number(p.mrp)
                : line.qty * Number(p.mrp)
              return (
                <Box
                  key={p.id}
                  sx={{
                    display: 'flex', flexDirection: 'column', gap: 0.5,
                    px: 1.5, py: 1,
                    borderBottom: '1px solid rgba(31,31,31,0.08)',
                    '&:last-child': { borderBottom: 'none' },
                    bgcolor: isPartial ? '#FFF8E1' : 'transparent',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ fontSize: 13, fontWeight: 700 }}>{p.name}</Box>
                      <Box sx={{ fontSize: 11, color: '#1F1F1F99' }}>
                        {p.code} · {line.qty} × {formatINR(Number(p.mrp))}
                        {isWeightBased && ` · pack ${p.weightValue}${unit}`}
                      </Box>
                    </Box>
                    {isWeightBased ? (
                      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                        <Button
                          size="small"
                          variant={!isPartial ? 'contained' : 'outlined'}
                          onClick={() => {
                            setCart(prev => {
                              const n = new Map(prev)
                              const l = n.get(p.id)!
                              n.set(p.id, { ...l, returnWeightG: undefined })
                              return n
                            })
                          }}
                          sx={{ textTransform: 'none', fontSize: 11, minHeight: 0, py: 0.4 }}
                        >
                          Full
                        </Button>
                        <Button
                          size="small"
                          variant={isPartial ? 'contained' : 'outlined'}
                          onClick={() => {
                            setCart(prev => {
                              const n = new Map(prev)
                              const l = n.get(p.id)!
                              // Default to half-pack when toggling on — safe non-zero start.
                              n.set(p.id, { ...l, returnWeightG: Math.round(packG / 2) })
                              return n
                            })
                          }}
                          sx={{ textTransform: 'none', fontSize: 11, minHeight: 0, py: 0.4 }}
                        >
                          Partial
                        </Button>
                      </Box>
                    ) : (
                      <Box sx={{ fontSize: 10.5, color: '#1F1F1F55', fontStyle: 'italic' }}>
                        full-pack only
                      </Box>
                    )}
                  </Box>
                  {isPartial && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                      <Box sx={{ fontSize: 11, fontWeight: 600, color: '#7C4A00' }}>Weight (g):</Box>
                      <TextField
                        type="text"
                        size="small"
                        value={line.returnWeightG ?? ''}
                        onChange={e => {
                          const v = e.target.value
                          if (v === '') return
                          if (!/^\d+$/.test(v)) return
                          const parsed = parseInt(v, 10)
                          if (!Number.isFinite(parsed)) return
                          const clamped = Math.max(1, Math.min(parsed, maxG))
                          setCart(prev => {
                            const n = new Map(prev)
                            const l = n.get(p.id)!
                            n.set(p.id, { ...l, returnWeightG: clamped })
                            return n
                          })
                        }}
                        onKeyDown={e => { if (['e', 'E', '+', '-', '.', ','].includes(e.key)) e.preventDefault() }}
                        onFocus={e => (e.target as HTMLInputElement).select()}
                        slotProps={{ htmlInput: { inputMode: 'numeric', style: { textAlign: 'center', padding: '4px 8px', width: 72 } } }}
                        sx={{ width: 92 }}
                      />
                      <Box sx={{ fontSize: 11, color: '#1F1F1F99' }}>
                        of {maxG}g · credit {formatINR(credit)}
                      </Box>
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
          {(() => {
            const total = Array.from(cart.values()).reduce((s, l) => {
              const p = l.product
              const unit = p.weightUnit ?? ''
              const packG = (unit === 'g' || unit === 'kg') ? Number(p.weightValue ?? 0) * (unit === 'kg' ? 1000 : 1) : 0
              const val = l.returnWeightG != null && packG > 0
                ? (l.returnWeightG / packG) * Number(p.mrp)
                : l.qty * Number(p.mrp)
              return s + val
            }, 0)
            return (
              <Box sx={{ mt: 1.5, fontSize: 13, fontWeight: 700 }}>
                Total credit claimed: {formatINR(total)}
              </Box>
            )
          })()}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            onClick={() => setReturnConfigOpen(false)}
            variant="outlined"
            disabled={createReturnMutation.isPending}
            sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#1F1F1F', color: '#1F1F1F' }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={cart.size === 0 || createReturnMutation.isPending}
            onClick={async () => {
              await handleSubmitAsReturn()
              setReturnConfigOpen(false)
            }}
            sx={{
              textTransform: 'none', fontWeight: 700,
              background: '#C62828', color: '#FFFFFF',
              '&:hover': { background: '#A82020' },
            }}
          >
            {createReturnMutation.isPending ? 'Submitting…' : 'Submit Return'}
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
                ...(isAdminCreate && adminShopId ? { shopId: adminShopId } : {}),
              })
              setDraftSavedAt(new Date())
              setIsDraftDirty(false)
              guard.proceed?.()
            }
          : undefined}
        onDiscard={() => guard.proceed?.()}
        onCancel={() => guard.reset?.()}
      />

      {/* Discard Draft confirm — gated so an accidental click on the
          sticky bottom bar doesn't wipe minutes of cart-building. */}
      <ConfirmDialog
        open={discardConfirmOpen}
        title="Discard this draft?"
        message="Your saved cart and notes will be cleared. You'll have to start the request from scratch. This can't be undone."
        confirmLabel="Yes, discard"
        cancelLabel="Keep editing"
        onConfirm={handleDiscardDraft}
        onCancel={() => setDiscardConfirmOpen(false)}
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
// Pack-weight grouping helper. Returns weight-keyed sections, sorted (g
// before kg, then by ascending magnitude). NULL-weight items land in their
// own "No weight specified" bucket at the end.
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

// Group products by their (sub-)category, then by weight within each
// sub-cat. The sub-cat label shows the breadcrumb path RELATIVE to the
// selected root when one is selected (e.g. "Spicy > Kara Sev" when root
// is "Snacks"), otherwise the full path. Order matches the category tree
// (root-first, path-sorted) by leaning on each category's `path` field.
type CategoryGroup = {
  catId:        number
  catLabel:     string          // heading shown above the weight groups
  weightGroups: { label: string; items: ProductDto[] }[]
}
function groupProductsByCategoryThenWeight(
  products:        ProductDto[],
  allCats:         { id: number; name: string; path: string | null; parentId: number | null }[],
  selectedRootId:  number | null,
): CategoryGroup[] {
  // catId → ProductDto[]
  const byCat = new Map<number, ProductDto[]>()
  for (const p of products) {
    const arr = byCat.get(p.categoryId)
    if (arr) arr.push(p)
    else byCat.set(p.categoryId, [p])
  }
  // Resolve display label + sort key from the categories list. Categories
  // list arrives in root-first path-sorted order so we use the cat's index
  // in that list as a natural sort key.
  const catIndex = new Map(allCats.map((c, i) => [c.id, i]))
  const selectedRootName = selectedRootId != null
    ? (allCats.find(c => c.id === selectedRootId)?.name ?? null)
    : null

  const result: CategoryGroup[] = []
  for (const [catId, items] of byCat.entries()) {
    const cat = allCats.find(c => c.id === catId)
    let label = cat?.path ?? cat?.name ?? `Category ${catId}`
    // Strip the selected root's prefix from the path so headings read
    // "Spicy > Kara Sev" instead of "Snacks > Spicy > Kara Sev" when the
    // user already knows they're inside Snacks.
    if (selectedRootName) {
      const prefix = `${selectedRootName} > `
      if (label.startsWith(prefix)) label = label.slice(prefix.length)
      else if (label === selectedRootName) label = selectedRootName  // root itself — keep
    }
    result.push({
      catId,
      catLabel:     label,
      weightGroups: groupProductsByWeight(items),
    })
  }
  result.sort((a, b) => (catIndex.get(a.catId) ?? 0) - (catIndex.get(b.catId) ?? 0))
  return result
}

function ProductsTable({
  catGroups,
  cart,
  onSetQty,
  onEnterAtEnd,
}: {
  catGroups: CategoryGroup[]
  cart: Map<string, CartLine>
  onSetQty: (product: ProductDto, qty: number) => void
  onEnterAtEnd?: () => void
}) {
  // Always render sub-cat headings — when the parent screen splits cat-groups
  // across two columns, a "hide when only one" rule on a per-column basis
  // would make the left and right tables look inconsistent (one with headings,
  // one without). Always-on is cheaper to reason about.
  const showCatHeadings = true
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
            {catGroups.map(cg => {
              const itemCount = cg.weightGroups.reduce((n, g) => n + g.items.length, 0)
              return (
                <Fragment key={cg.catId}>
                  {showCatHeadings && (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        sx={{
                          // Metallic gold gradient (#C28A00 → #FFD700 → #FFF1A6)
                          // with dark text. Luxury brand-feel sweep; reads as
                          // the OUTER grouping layer next to the cream weight bar.
                          background: 'linear-gradient(90deg, #C28A00 0%, #E6B800 35%, #FFD700 65%, #FFF1A6 100%)',
                          color: '#1F1F1F',
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          letterSpacing: 0.8,
                          fontSize: 13,
                          py: 1.25,
                          pl: 2,
                          borderTop: '2px solid #1F1F1F',
                        }}
                      >
                        {cg.catLabel}
                        <Box component="span" sx={{ ml: 1.5, color: '#1F1F1F99', fontWeight: 600, fontSize: 11 }}>
                          · {itemCount} {itemCount === 1 ? 'product' : 'products'}
                        </Box>
                      </TableCell>
                    </TableRow>
                  )}
                  {cg.weightGroups.map(group => (
                    <Fragment key={`${cg.catId}__${group.label}`}>
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
                          onEnterAtEnd={onEnterAtEnd}
                        />
                      ))}
                    </Fragment>
                  ))}
                </Fragment>
              )
            })}
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
  onEnterAtEnd,
}: {
  product: ProductDto
  qty: number
  onSetQty: (product: ProductDto, qty: number) => void
  /** Optional: fires when Enter is pressed on the LAST .qty-input in
   *  document order (nothing to advance to). Parent uses this to jump
   *  to the next category. 02-Jul-2026. */
  onEnterAtEnd?: () => void
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
          onKeyDown={e => {
            if (['e', 'E', '+', '-', '.', ','].includes(e.key)) e.preventDefault()
            // Enter AND Tab both traverse the qty inputs in document order.
            // Native Tab would jump to whatever DOM element follows the
            // input (the next category chip in the top strip on this page)
            // — client bug 06-Jul-2026: "Tab pressing goes to 2nd category
            // instead of the next product qty". Hijacking Tab keeps focus
            // inside the qty column so muscle-memory matches Enter.
            // Shift+Tab still steps backwards through the qty inputs; when
            // no next / previous qty exists, only Enter's onEnterAtEnd
            // fires (Tab off the last qty stays put so the user can Shift-
            // Tab back without losing their spot).
            if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
              e.preventDefault()
              const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.qty-input'))
              const idx = inputs.indexOf(e.currentTarget)
              const next = inputs[idx + 1]
              if (next) { next.focus(); return }
              // No more qty inputs — Enter jumps to the next category (via
              // onEnterAtEnd), Tab stays put to avoid an accidental
              // navigation the user didn't ask for.
              if (e.key === 'Enter' && onEnterAtEnd) {
                // Blur to release focus + defer the state change one tick
                // so the current keydown event finishes cleanly before
                // React starts re-rendering. In-tick unmount of the
                // focused input was breaking the follow-up programmatic
                // focus() from useEffect (cursor stayed on <body>).
                ;(e.currentTarget as HTMLInputElement).blur()
                setTimeout(() => onEnterAtEnd(), 0)
              }
            } else if (e.key === 'Tab' && e.shiftKey) {
              // Shift+Tab → previous qty. Falls through to native Tab when
              // we're already on the first input (user can leave the qty
              // column upwards to the category picker).
              const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.qty-input'))
              const idx = inputs.indexOf(e.currentTarget)
              const prev = inputs[idx - 1]
              if (prev) { e.preventDefault(); prev.focus() }
            }
          }}
          // Block mouse-wheel from adjusting the qty (default browser
          // behaviour on <input type="number"> steps the value on scroll —
          // shop user was hitting this by accident while scrolling the
          // long product list). Blur so the wheel event scrolls the page
          // instead. 02-Jul-2026.
          onWheel={e => (e.target as HTMLInputElement).blur()}
          // Auto-center focused qty in the viewport + auto-select the
          // existing value so tab-navigation stays self-guiding AND a
          // fresh type replaces the value instead of appending. Same
          // treatment as inventory dispatch qty inputs.
          onFocus={e => {
            const el = e.target as HTMLInputElement
            el.scrollIntoView({ block: 'center', behavior: 'smooth' })
            el.select()
          }}
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
