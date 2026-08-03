# Shop Stock-Take — FE Screens Plan

> Backend + API + hooks + types are ALREADY BUILT. Only React screens,
> router entries, and a sidebar menu item are missing. This doc lays out
> the FE work needed to light the whole feature up.
>
> Feature purpose (short): periodic **shelf-wide physical count** to
> reconcile system on_hand with reality. Catches drift that per-receipt
> confirmation cannot see — unrecorded cash sales (pre-POS), shelf
> damage/spoilage, theft/shrinkage, expiry discards, accumulated data
> errors. See earlier explainer in chat for the receive-confirm-vs-stock-
> take distinction with concrete examples.

## What's already built (do not touch)

### DB (`phase4_shop_inventory_procedures.sql`)
- `fn_stock_take_start(shop_id, created_by)` — new Draft session, snapshots all shop_inventory rows as line items with system_qty = current on_hand
- `fn_stock_take_upsert_line(stock_take_id, product_id, counted_qty, note)` — save/overwrite one counted line; system_qty auto-refetched when product was added AFTER Start
- `fn_stock_take_submit(id, submitted_by)` — writes one `Adjustment` movement per non-zero diff, marks Submitted
- `fn_stock_take_cancel(id, reason, cancelled_by)`
- `fn_stock_take_list(shop_id, status?, from?, to?, page, pageSize)` — history rollup
- `fn_stock_take_detail(id)` — full lines list

### BE (`ShopInventoryController.cs`)
All under `/api/shop-inventory/` prefix, `[Authorize(Roles = ShopUser,Admin)]`:
- POST `stock-takes?shopId=…` → StartStockTake (returns full detail)
- GET  `stock-takes/{id}` → GetStockTake
- GET  `stock-takes?shopId&status&fromDate&toDate&page&pageSize` → ListStockTakes (paged)
- PUT  `stock-takes/{id}/lines` — body `{ productId, countedQty, note? }` → UpsertStockTakeLine
- POST `stock-takes/{id}/submit` → SubmitStockTake (Draft → Submitted, movements posted)
- POST `stock-takes/{id}/cancel` — body `{ reason }` → CancelStockTake

### FE plumbing
- `api/shop-inventory/types.ts` — `StockTakeSummaryDto`, `StockTakeItemDto`, `StockTakeDetailDto`, `UpsertStockTakeLineRequest`, `CancelStockTakeRequest`, `StockTakeListFilters`, `StockTakeStatus`
- `api/shop-inventory/api.ts` — `startStockTake`, `getStockTake`, `listStockTakes`, `upsertStockTakeLine`, `submitStockTake`, `cancelStockTake`
- `hooks/useShopInventory.ts` — matching TanStack Query hooks: `useStockTakes`, `useStockTake`, `useStartStockTake`, `useUpsertStockTakeLine`, `useSubmitStockTake`, `useCancelStockTake`

**Every hook + query key is done.** New screens plug straight in — no new plumbing.

## Screens to build (FE only)

Three new pages, one sidebar item, three router entries.

### 1. `/shop/stock-takes` — History list

**File:** `front-end/src/pages/shop/ShopStockTakes.tsx`

- Uses `useStockTakes(filters)` — already returns `PagedResult<StockTakeSummaryDto>`
- MUI DataGrid (same pattern as `ShopUtilities.tsx` history table):
  - Columns: Code (`STK0007`), Status chip (Draft/Submitted/Cancelled), Started at, Submitted at, Lines counted, Diffs, Net qty diff
  - Row click → navigate to `/shop/stock-takes/{id}`
- Top-right button **"Start new count"** — calls `useStartStockTake()`
  - Success → navigate to new take's detail page
  - Error 409 (draft already exists) → toast: *"A draft is already open — resume it below"* + auto-scroll the existing Draft row to top
- Empty state (no takes ever): *"No stock-takes yet. Click 'Start new count' to reconcile shelf stock with the system."*
- Filters (collapsible, same UX as StockRequests):
  - Status (Draft / Submitted / Cancelled)
  - Date range (started_at)

### 2. `/shop/stock-takes/new` — Redirect helper

**Not a real page.** The "Start new count" button on the history page hits `useStartStockTake` and navigates to `/shop/stock-takes/{newId}`. No dedicated new-page needed.

*(If we later want a landing that says "You are about to count 142 SKUs — confirm?", make this a real screen. For now, just create + go.)*

### 3. `/shop/stock-takes/:id` — Entry / detail

**File:** `front-end/src/pages/shop/ShopStockTakeDetail.tsx`

Uses `useStockTake(id)` — returns full `StockTakeDetailDto` with `items[]`.

**Header:**
- Code + status chip
- Started at / Submitted at (if submitted)
- Rollup badges: `N of M counted` · `K diffs` · `Net −12` (red when non-zero)
- Actions (right):
  - Draft → **"Submit"** (large primary) + **"Cancel"** (outlined danger)
  - Submitted / Cancelled → both hidden; header shows read-only

**Body — line editor** (only meaningful part):
- DataGrid, one row per SKU. Sorted by category, then product code.
- Columns:
  - Product code + name
  - Category (grouped/sticky header)
  - System qty (read-only, from snapshot)
  - **Counted qty** (numeric input, inline, autofocus per row via keyboard nav)
  - Diff (computed: counted − system; red when non-zero, grey when 0, dim when uncounted)
  - Note (small icon → popover text area, per row)
- Behaviour:
  - Server round-trip on **blur** of counted-qty (debounced 400ms) via `useUpsertStockTakeLine`
  - Optimistic update: local Map<productId, {counted, note}> layered over server data, so keystrokes don't wait for the POST
  - "Uncounted" state = `counted_qty IS NULL` (server-side). Distinguish visually from "counted 0" (which means shelf really is empty)
  - Filter bar (top of grid): "Show only diffs", "Show only uncounted", search by product name/code
- Draft-only: all inputs enabled
- Submitted / Cancelled: all read-only, "Diff" column keeps its colour

**Submit flow:**
- Click Submit → confirm dialog: *"Post N adjustment movements? Diffs are irreversible."*
- On confirm → `useSubmitStockTake(id)` → BE posts one `Adjustment` movement per non-zero diff, flips status
- Toast: *"12 stock corrections applied."*
- Stays on the same URL; the page auto-flips to read-only (same route, hook re-renders because status changed)

**Cancel flow:**
- Click Cancel → dialog with reason text field (required, min 5 chars — same shape as `CancelReturnRequestDialog.tsx`)
- On confirm → `useCancelStockTake(id, { reason })`
- Toast: *"Stock-take cancelled."*
- Flips to Cancelled read-only view

**Guardrails:**
- Empty diffs on Submit: BE allows it (Submitted with 0 adjustments = "we counted, everything matched" — valid signal). Don't block on FE either.
- Cannot start a new take while a Draft exists — enforced BE; FE catches the 409 as noted above.
- Route guard: `useStockTake` returns 403 if the take belongs to another shop (already enforced BE). FE handles by showing "Not found or not accessible" panel.

## Sidebar entry

**File:** `front-end/src/components/ShopSidebar.tsx`

Add one entry under the shop nav, between "Dashboard" and "Requests":
- Icon: `ClipboardCheck` (from lucide-react) — same icon already used on the dashboard "Last stock-take" card
- Label: **"Stock Count"** (shorter than "Stock-take", scans better in the sidebar)
- Path: `/shop/stock-takes`
- Active state on any `/shop/stock-takes/*` route

## Router entries

**File:** `front-end/src/App.tsx`

Under the shop-user routes group:
```tsx
<Route path="stock-takes" element={<ShopStockTakes />} />
<Route path="stock-takes/:id" element={<ShopStockTakeDetail />} />
```

No admin-side view initially — admin drills into a shop via the shop-dashboard shopId param, which then surfaces the same routes. If admin needs a cross-shop stock-take audit later, add `/admin/stock-takes` reusing the same components with a shop filter.

## Dashboard "Last stock-take" card behaviour

**File:** `front-end/src/pages/shop/ShopDashboard.tsx`

Two adjustments:
1. When `data.lastStockTake` is null AND user is a ShopUser: change empty-state hint from *"Run a physical count to reconcile shelf stock with the system."* to a real CTA that links to `/shop/stock-takes` — since the entry point now exists.
2. When `data.lastStockTake` is present: make the whole card a hover-pointer that navigates to `/shop/stock-takes/{lastStockTake.id}`.

Card is otherwise unchanged — no action buttons ON the card (dashboard is view-only per project convention).

## Estimate

- Sidebar + router + skeleton files: ~1 hour
- `ShopStockTakes.tsx` (history list + start button): ~3 hours
- `ShopStockTakeDetail.tsx` (line editor + submit/cancel + optimistic sync): ~1 full day
- Dashboard card polish: ~30 min
- Manual QA + a small `.md` review checklist: ~2 hours

**Total: ~2 dev days.** Zero BE risk (fully live, exercised by unit tests). All work is FE polish + wiring.

## Rollout timing

**Recommendation: build alongside POS Phase 5** — same team is doing POS, same "stock-adjust" mental model, same shop-user training session. Bundled release story reads cleaner than shipping a stock-take feature in isolation while POS is still coming.

**If POS ships first:** stock-take becomes a Phase 5b micro-followup, ~2 days after POS lands.

## Open decisions before starting

- **Menu label** — "Stock Count" vs "Stock-take" vs "Physical Count". Recommend **Stock Count** (shortest, plain).
- **Line editor unit for weight-based SKUs** — count in packets or in weight? Recommend **packets only** for MVP (matches how the shop actually counts a shelf); weight-based diffs are rare and can be handled by adjust-endpoint if ever needed.
- **Post-submit navigation** — stay on detail page (recommended) vs jump back to history? Stay = user sees the applied diffs highlighted, closes the loop.
- **Concurrency** — two users editing the same Draft. SP is currently last-write-wins per line. Fine for MVP (rare in a small shop). If it becomes an issue, add a `updated_at` optimistic-lock on `shop_stock_take_items`.

## What NOT to build now

- No printable "count sheet" export (owner counts on paper first, then types in) — skip until asked
- No barcode scanner input mode — skip until asked
- No mid-count-take pause/resume warning — Draft persists indefinitely by design
- No mobile-tuned UI — desktop-first, MUI defaults handle small screens acceptably
