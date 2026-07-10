# POS Billing (shop-counter walk-in sales) — "Phase 5"

> **Status:** Planned — not built. Drafted 02-Jul-2026 in response to a client ask
> for a shop-counter billing screen. Named "Phase 5" to match the terminology
> already sitting in the codebase (see below) — Phase 4 was never used, so this
> picks up the number the code already promised.

## Why this is already half-anticipated

Three places already forward-reference this exact feature:

| File | Comment |
|---|---|
| `DB/phase1/phase1_init.sql:74` | `shops.gst_enabled` — "later used by Phase 5 POS billing to decide whether bills include GST line items" |
| `DB/phase2/phase2_init.sql:77` | `app_settings.gst_enabled` — "Phase 5 POS billing" drives per-shop GST |
| `front-end/.../AdminSettings.tsx:209` | "Used by the POS billing flow to decide whether each shop's bills include GST line items" |

`products.gst` also already exists (nullable, hidden in the product form — the
schema comment says "client will surface it in a later phase"). This build is
that later phase: it's the first feature that actually *reads* these three
fields instead of just carrying them.

## Problem

Shops currently only have a **request pipeline to the godown** (Order/Return).
There's no way to record a walk-in customer buying snacks over the counter.
Two things are missing to support that:

1. **No on-hand stock concept.** The DB tracks `dispatched_qty` /
   `requested_qty` on requests, but nothing answers "how many packets of
   Kara Sev does Shop SHP003 have on its shelf right now?" A counter sale
   needs to check and reduce that number.
2. **No billing screen.** Nothing lets a shop user pick products, quantities,
   and print a bill for a customer who is standing at the counter, unlike a
   stock request which is async and multi-day.

## Decisions already made (client answers, 02-Jul-2026)

| Question | Decision |
|---|---|
| Stock enforcement | **Yes** — add real on-hand stock tracking per shop/product (new ledger), POS checks/decrements it. |
| Payment mode | **Not tracked.** POS only totals and prints; cash/UPI/card split is out of scope. |
| Customer capture | **Fully anonymous.** No customer field anywhere on the bill. |
| Access | **ShopUser only.** Inventory/godown counter sales are not in scope. |
| Item entry | **Barcode scan only** (02-Jul-2026 follow-up). Manual browse/search is a fallback state, not the primary flow — see Interaction model below. |
| Input device | **Touch only.** No physical keyboard/mouse at the counter — every on-screen control (qty edit, search fallback) must be tappable; a barcode scanner is the only "keyboard-like" input, and it's external hardware. |

## Interaction model: barcode-scan + touch-only (02-Jul-2026 follow-up)

Two follow-up constraints from the client materially change the FE design
below and surface a real data gap:

1. **No `barcode` column exists on `products` today** — only the internal
   `code` (P001, P002…). Scan-only billing needs every sellable product to
   resolve from a scanned string to a product row. This catalogue almost
   certainly has **two kinds of products**: bought-in branded goods (real
   manufacturer UPC/EAN barcodes already printed on the pack — e.g. the
   Biscuits category) and in-house packed murukku/snacks (no manufacturer
   barcode at all). Both need a `products.barcode varchar(64)` column, but
   populated two different ways — see Data model below.
2. **"Jar" type products** (existing `type: 'pack' | 'jar'` field) are
   loose/bulk items sold by scoop/weight. They physically cannot carry a
   barcode. Pure scan-only breaks for this whole category — the POS screen
   needs a manual-add fallback that isn't just an edge case, it's the
   *only* path for every jar-type product.
3. **Virtual-keyboard interference (implementation risk, not a screen)** — a
   barcode scanner is a keyboard-wedge HID device: it "types" into whatever
   text field has focus, then sends Enter. On a touch tablet, focusing a
   plain `<input>` to catch that pops up the OS on-screen keyboard and
   covers half the screen. Mitigate with `inputMode="none"` (or
   `readOnly` + a scanner in Bluetooth-HID mode) on the scan-capture field,
   and test on the actual target tablet before rollout — this is a common
   gotcha that doesn't show up until real hardware is used.

## Approach: new `pos_sales` capability + a `shop_stock` ledger

Two new pieces, kept independent of the existing request tables (no schema
changes to `stock_requests` / `stock_request_items` beyond the hooks below):

- **`shop_stock`** — one row per (shop, product), holding `qty_on_hand`.
  Incremented when an Order is **Received**, decremented when a Return is
  **created** (goods physically leave the shelf when boxed for return) and
  when a **POS sale** is created. Admin can also correct it directly
  (damage/spoilage/physical-count mismatch), audit-tracked.
- **`pos_sales` / `pos_sale_items`** — a bill header + line items, modeled
  directly on `stock_requests` / `stock_request_items` (same
  code-sequence-generation pattern, same snapshot-pricing pattern) but far
  simpler: no lifecycle beyond Completed → optionally Voided.

### Why a ledger instead of computing stock on the fly

Stock-on-hand could theoretically be derived by scanning every Received
request minus every POS sale minus every Return, but that's an increasingly
expensive aggregate query every time the POS screen loads (it has to run on
every keystroke of the product search). A maintained running balance,
updated transactionally by the same SPs that already mutate
requests/returns/sales, is the same pattern the codebase already uses for
`stock_requests.total_items/total_qty/total_amount` (cached aggregates kept
in sync by the mutating SPs, per `phase2_init.sql:102-105`).

## Data model changes

### New table: `shop_stock`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `shop_id` | uuid FK → shops | |
| `product_id` | uuid FK → products | |
| `qty_on_hand` | int, default 0 | **No DB-level `CHECK >= 0`** — see oversell decision below; enforcement lives in the SP layer so the policy can be toggled without a schema change. |
| `updated_at` / `updated_by` | | |

`UNIQUE (shop_id, product_id)`. One row is upserted (created on first
movement) rather than pre-seeded for every shop×product combination.

### New table: `shop_stock_adjustments` (audit trail)

Mirrors `stock_request_qty_audits` exactly: `shop_id, product_id, old_qty,
new_qty, reason, adjusted_by, adjusted_at`, append-only. Needed the moment
Admin corrects a shelf-count discrepancy — otherwise a stock number that
silently jumps is unauditable.

### New table: `pos_sales` (header)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `code` | varchar UNIQUE | `seq_pos_sale_code` → `POS0001`, same pattern as `seq_request_code` / `seq_product_code`. |
| `shop_id` | uuid FK → shops | |
| `total_items` / `total_qty` | int | cached aggregates |
| `taxable_amount` / `gst_amount` / `total_amount` | numeric(12,2) | see GST section below — `total_amount` = sum of line MRPs, `taxable_amount + gst_amount = total_amount` |
| `notes` | varchar(500) | optional |
| `is_voided`, `voided_at`, `voided_by`, `void_reason` | | see Void decision below |
| `created_at`, `created_by` | | `created_by` = the ShopUser who billed it |

No `status` enum — a sale is Completed the instant it's created (unlike a
request, there's no approve/dispatch step), so the only state transition is
Completed → Voided.

### New table: `pos_sale_items`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `sale_id` | uuid FK → pos_sales, `ON DELETE CASCADE` | |
| `product_id` | uuid FK → products | |
| `qty` | int, `CHECK (qty > 0)` | |
| `unit_price` | numeric(10,2) | **MRP snapshot at sale time** — same snapshot rationale as `stock_request_items.unit_price` (a later MRP edit shouldn't rewrite history). |
| `gst_rate` | numeric(5,2), nullable | snapshot of `products.gst` at sale time |
| `subtotal` | GENERATED `qty * unit_price` STORED | |

`UNIQUE (sale_id, product_id)` — same product can't appear twice on one bill
(matches `stock_request_items`' rule); the counter staff adjusts quantity on
the existing line instead.

### GST handling (uses the fields that already exist)

Indian FMCG MRP is tax-**inclusive** by convention, so a bill doesn't add GST
on top of MRP — it **splits** the MRP already charged into taxable value +
tax, for the printed receipt / compliance record:

```
taxable_value = mrp / (1 + gst_rate/100)
gst_amount    = mrp - taxable_value
```

The GST block only appears on a bill when **both**
`app_settings.gst_enabled = true` **and** the sale's `shops.gst_enabled =
true` — exactly the two flags the codebase already wired up for this
purpose. When either is off, the bill shows a flat total with no tax lines
(research finding: showing a zeroed tax block on a non-GST shop's bill reads
as confusing/wrong, not just unnecessary).

**This build also finally surfaces the hidden `products.gst` field** in the
Products add/edit form (currently hidden per the schema comment) — POS can't
split tax on a product with an unset GST rate.

### Modified table: `products` — add `barcode`

| Column | Type | Notes |
|---|---|---|
| `barcode` | varchar(64), nullable | The scannable string. Populated one of two ways (see below). |

`UNIQUE (barcode) WHERE barcode IS NOT NULL AND is_deleted = false` — same
partial-unique shape as the category name index, so two active products
can't collide on the same barcode, but soft-deleted rows don't block reuse.

**Two population paths, both from the Products add/edit form:**

- **"Scan to capture"** — for bought-in branded items: focus the barcode
  field, scan the manufacturer's own barcode off the physical pack, save.
  No new code is generated; the real UPC/EAN is stored as-is.
- **"Generate & print label"** — for in-house packed items with no
  manufacturer barcode: encode the existing `products.code` (e.g. `P001`)
  as a Code128/QR image and store `barcode = code` (or a prefixed variant
  like `IN-P001` if the raw P-code risks colliding with a real UPC/EAN
  format — open decision below). Admin then prints and sticks the label on
  the pack.

Jar-type products are expected to have `barcode IS NULL` — the POS manual-add
fallback is their only path, not an oversight to fix later.

## SPs to add (DB/phase5/phase5_procedures.sql)

Following the existing `fn_<entity>_<action>` convention:

- `fn_pos_sale_next_code()` — sequence-backed, same shape as `fn_product_next_code`/`fn_request_next_code`.
- `fn_pos_sale_create(p_shop_id, p_user_id, p_items jsonb, p_notes)` — validates each line's stock (unless oversell is allowed, see below), inserts header + items, decrements `shop_stock` per line, all in one transaction.
- `fn_pos_sale_get(p_id)`, `fn_pos_sale_list_paged(...)`, `fn_pos_sale_count(...)` — mirrors the request list/get/count trio.
- `fn_pos_sale_void(p_id, p_user_id, p_reason)` — re-increments `shop_stock`, sets the voided columns.
- `fn_shop_stock_get(p_shop_id)` / `fn_shop_stock_list_paged(...)` — powers both the POS product picker's "in stock" numbers and an admin stock-review screen.
- `fn_shop_stock_adjust(p_shop_id, p_product_id, p_new_qty, p_reason, p_user_id)` — admin-only correction, writes to `shop_stock_adjustments`.
- `fn_shop_stock_seed_bulk(p_shop_id, p_rows jsonb, p_user_id)` — opening-stock import at cutover (see Rollout below), same jsonb-array-of-rows shape as `fn_product_create_bulk`.
- `fn_product_find_by_barcode(p_barcode varchar)` — the actual scan-resolve
  call the POS screen hits on every scan. Returns the same shape as
  `fn_product_get` (or NULL/no-rows on a miss, which the FE turns into the
  "barcode not recognized" state). This is the hot path of the whole
  screen — index the new `barcode` column (the partial unique index above
  already gives it one for free).

### Existing SP that needs a param added

- **`fn_product_update`** (`phase1_procedures.sql:423`) and
  **`fn_product_create`** (`phase1_procedures.sql:394`) — add a
  `p_barcode varchar` parameter, following the exact same 5-file mechanical
  change CLAUDE.md already documents for "Adding a field to StockRequestDto"
  (SP → entity → DTO → service mapper → FE type), just for `ProductDto`
  instead.

### Existing SPs that need a hook added (Modified Capabilities)

- **`fn_request_receive`** (`phase2_procedures.sql:1420`) — on an Order being
  marked Received, upsert `shop_stock.qty_on_hand += dispatched_qty` for
  every item.
- **`fn_request_create_return`** (`phase2_procedures.sql:1483`) — on Return
  creation, upsert `shop_stock.qty_on_hand -= requested_qty` for every item
  (goods leave the shelf when boxed up, before the godown has accepted them
  back).

These are the only two touches to Phase 2 — no schema change to
`stock_requests`/`stock_request_items` themselves, just an extra `UPDATE`
inside two existing functions.

## Backend (.NET) — new resource folders, same shape as StockRequests/Accounts

- `API/Controllers/PosSalesController.cs` — `POST /api/pos-sales` (ShopUser
  only, shop_id pulled from the JWT claim like request creation does),
  `GET /api/pos-sales`, `GET /api/pos-sales/{id}`,
  `POST /api/pos-sales/{id}/void`.
- `API/Controllers/ShopStockController.cs` — `GET /api/shop-stock` (own shop
  for ShopUser, any shop for Admin), `POST /api/shop-stock/adjust`
  (Admin only), `POST /api/shop-stock/seed-bulk` (Admin only).
- `API/Controllers/ProductsController.cs` — one new endpoint,
  `GET /api/products/by-barcode/{barcode}` (ShopUser + Admin), the
  server-side half of the scan-resolve hot path. `ProductDto` gains a
  `barcode` field (mechanical change per CLAUDE.md's existing 5-file
  pattern).
- `Business/DTOs/PosSales/*`, `Business/DTOs/ShopStock/*`.
- `Business/Validators/PosSales/CreatePosSaleRequestValidator.cs` — qty > 0,
  no duplicate product lines, non-empty cart.
- `Business/Interface` + `Implementation`: `IPosSaleService`,
  `IShopStockService`.
- `Repository/Entities/PosSale.cs`, `PosSaleItem.cs`, `ShopStock.cs`,
  `ShopStockAdjustment.cs` — PascalCase-with-underscores, matching the
  existing entity convention.
- `Repository/Interface` + `Implementation`: `IPosSaleRepository`,
  `IShopStockRepository`.

## Frontend — screen inventory (updated for scan-only + touch-only)

The grid/browse-first layout from the first draft of this doc is replaced —
scanning is the primary path, browsing is the fallback. Full screen list:

### A. Admin / setup (prerequisite)

1. **`Products.tsx` add/edit form** — un-hide the GST % field (already
   planned), **plus a new Barcode field** with two touch-friendly actions:
   "Scan to capture" (focuses the barcode input so a scan populates it —
   for bought-in branded items) and "Generate code" (fills it from the
   product's existing `code` for in-house items with no manufacturer
   barcode — see Data model above).
2. **`/print/barcode-labels`** (new) — pick one or more products (checkbox
   list, reuses the existing Products table selection pattern) → renders a
   sheet of Code128/QR sticker labels sized for the shop's printer, same
   `window.print()` + dedicated print CSS approach as the existing
   thermal/A4 print pages. Needed for every in-house item before it can be
   scanned at all.
3. **`AdminShopStock.tsx`** (new) — per-shop on-hand stock table + inline
   adjust action (unchanged from the original plan).
4. **Opening-stock bulk import** — dialog on the same page, reusing the
   `ImportProductsDialog` / ClosedXML pattern (unchanged from the original
   plan).

### B. ShopUser / counter — the actual POS

5. **`/shop/pos` — POS Billing (main screen)**:
   - **Scan zone**, not a product grid — a large, visually-obvious "ready to
     scan" panel holding an always-refocused input wired with
     `inputMode="none"` (see the virtual-keyboard risk above) so a scanner's
     keystrokes land there without ever raising the OS keyboard. Each
     successful scan calls `GET /api/products/by-barcode/{code}` and adds
     qty 1 to the cart, or increments the existing line if scanned again.
   - **"Add manually" button** — the *only* way to add jar-type/loose
     items, and the fallback for a damaged barcode or scanner outage. Opens
     a touch-driven search + tap-to-add picker (this is the old grid
     design, demoted from primary screen to a dialog).
   - **On-screen numeric keypad** (touch component, no physical keyboard
     available) — tapping a line's qty opens it to correct a scan-miscount
     (e.g. scanned 3, customer wants 5) without needing a text field.
   - **Cart panel** (always visible, right side or bottom sheet on a
     narrower tablet): line items with a bare "×" remove (no confirm — see
     original plan's rationale), Subtotal → GST (only if `gst_enabled` for
     this shop) → Total, then a large touch "Complete Sale" button.
   - **"Barcode not recognized" inline state** — scan-miss shows an alert
     inline in the scan zone ("No product found for 8901234567890") with a
     one-tap "Search manually" action; doesn't block the rest of the cart.
   - Optional Hold/Resume strip (unchanged open decision from the original
     plan — in-memory only for v1).
   - 44×44px minimum tap targets throughout (unchanged from the original
     plan).
6. **`/print/pos-sale/:id/thermal`** — receipt, cloned from
   `PrintRequestThermal.tsx` (unchanged from the original plan): item
   lines, GST split block (conditional), grand total, "Printed at" footer,
   no customer name.
7. **`/shop/pos-sales`** (new) — Sales History / Bill List for the shop:
   today's (and past) bills, reprint action, void action. Same list-page
   shape as `ShopRequests.tsx`.
8. **`/shop/pos-sales/:id`** (new) — Bill Detail: line items, totals, and
   (if within the void window) a "Void" button that opens a reason dialog
   — mirrors the existing `ConfirmDialog` + reason-field pattern used for
   request rejection.

### Other FE touches

- `ShopSidebar.tsx` — new "Billing" nav entry (ShopUser only), pointing at
  `/shop/pos`.
- `api/pos-sales/{api,types}.ts`, `api/shop-stock/{api,types}.ts`,
  `hooks/usePosSales.ts`, `hooks/useShopStock.ts`.
- `api/products/{api,types}.ts` — add `barcode` to `ProductDto`, add the
  `getProductByBarcode` call.

## Rollout: opening stock

Every shop starts at `qty_on_hand = 0` for every product until real
movement happens (a Received order or a POS sale). On day one that's wrong —
shops already have physical stock on their shelves. Before going live, an
admin needs to **bulk-seed `shop_stock`** per shop (the CSV/Excel import
mentioned above). This must ship in the same release as POS billing, or the
first day of counter sales will reject sales against phantom zero stock
(unless oversell is allowed — see below).

## Open decisions (need client input before building)

1. **Oversell policy** — can a sale go through when `qty_on_hand` would go
   negative? *Proposed:* block by default, with a new `app_settings` row
   (`pos_allow_oversell`, boolean, same master-switch pattern as
   `request_lock_enabled`) that Admin can flip on for a shop that hasn't
   finished opening-stock seeding yet.
2. **Void window** — who can void a completed sale, and until when?
   *Proposed:* ShopUser can void same-day; Admin can void anytime with a
   required reason (mirrors the qty-audit reason field pattern).
3. **Bill code prefix** — `POS0001` proposed; could also be `BILL0001` if
   that reads better on a printed receipt for customers.
4. **Held sales durability** — does a "Hold" survive a page refresh/logout
   (needs a `pos_sale_holds` table) or is in-memory-only acceptable for v1?
   *Proposed:* in-memory only for v1 — small counter operation, refresh
   mid-bill is rare — revisit if it becomes a real complaint.
5. **Discounts** — no client ask for line/bill discounts yet; the research
   above documents where a discount row *would* slot into the totals stack
   (Subtotal → Discount → Tax → Total) if it's wanted later.
6. **Self-generated barcode format** — encode the raw `code` (`P001`) as the
   barcode, or a prefixed variant (`IN-P001`) to visually/structurally
   distinguish in-house codes from real UPC/EAN codes at a glance? *Proposed:*
   prefixed — an unprefixed short numeric string risks looking like (and
   colliding in format with) a real barcode.
7. **Jar-type items at the counter** — confirm the "Add manually" fallback
   (tap-to-add, no barcode) is acceptable for every loose/weighed item, or
   whether jar items need their own quick-pick tile row pinned to the scan
   screen so staff aren't hunting through a search dialog for bestsellers.
   *Proposed:* start with the search dialog; revisit with a pinned
   quick-pick row if staff find it too slow in practice.

## Not in scope (deferred)

- Payment-mode tracking (cash/UPI/card) and reconciliation — explicit
  client decision.
- Customer master / repeat-customer lookup — explicit client decision
  (fully anonymous bills).
- Inventory/godown counter sales — ShopUser only per client decision.
- Barcode scanner hardware integration testing — the UI will be built
  scanner-compatible (an `inputMode="none"` capture field accepting
  keyboard-wedge input, per the interaction-model section above) but no
  physical scanner/tablet model has been confirmed to test against yet.
  **This is a hard prerequisite before the POS screen can be validated
  end-to-end** — the virtual-keyboard-suppression trick needs to be
  confirmed on the actual target device, not just assumed.
- Keyboard-shortcut power-user layer (Insert/Delete/N/P/Q/D-style) — moot
  under the touch-only decision, not merely deferred; there's no physical
  keyboard for a shortcut to bind to.
- **Phase 3 accounts roll-up** — `fn_accounts_*` SPs are anchored on
  `stock_requests` (`received_at`/`accepted_at`); POS sales are a different
  economic event (retail-to-consumer, not shop-to-godown) and won't appear
  in the existing Accounts dashboard automatically. Folding POS revenue into
  accounts reporting is a separate future change — flagging so it isn't
  assumed to "just work."
- Keyboard-shortcut power-user layer (Odoo-style Insert/Delete/N/P/Q/D) —
  good v2 addition once the touch/tap flow is validated with real counter
  staff; not required for a v1 launch.

## Build estimate (rough)

| Layer | Effort |
|---|---|
| DB (`DB/phase5/phase5_init.sql` + `phase5_procedures.sql`: 4 new tables + `products.barcode`, 2 sequences, ~10 SPs, 2 hooks into existing Phase 2 SPs, 2 param additions on Phase 1 product SPs) | 1.5 days |
| Backend (3 new/touched controllers, services, repositories, DTOs, validators) | 1.5 days |
| Frontend — POS billing screen (scan zone, virtual-keyboard-safe capture field, on-screen qty keypad, manual-add fallback dialog, barcode-miss state) | 2.5 days |
| Frontend — barcode label print page, Products form scan/generate actions | 1 day |
| Frontend — thermal receipt, sales history + bill detail/void, sidebar nav | 1 day |
| Frontend — admin stock-review page + opening-stock bulk import | 1 day |
| Testing (stock decrement/void edge cases, GST split correctness, oversell toggle, **real scanner + tablet hardware test**) | 1 day |
| **Total** | **~9.5 days** of build + test |
