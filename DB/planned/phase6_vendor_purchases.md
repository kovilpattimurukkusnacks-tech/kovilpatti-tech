# Phase 6 — Vendor Purchases + E-Way Bill Integration

> Concrete implementation plan for the vendor-purchases module (with e-way
> bill capture) proposed in `eway_bill_interstate_purchase.md`. That doc
> covers the *what* and *why* of e-way bills; this doc covers the *how* and
> *where* in the codebase — screens, tables, rollout order, and open
> decisions.
>
> Scheduled AFTER Phase 5 (POS Billing). Rationale: POS drives daily
> revenue capture (client's biggest ROI ask); Purchases drives cost
> accuracy + GST compliance (important but not blocking day-to-day
> operations).

## 1. Placement in the app

**Decision: standalone "Purchases" section on the Admin sidebar, parallel
to Requests / Accounts / Expenses.**

Alternatives considered and rejected:

| Option | Verdict |
|---|---|
| Standalone "Purchases" section (chosen) | Clear operational area — staff know exactly where purchase records live. Costs one extra sidebar entry, nothing more. |
| Sub-tab of Accounts | Rejected: Accounts is a *reporting* surface; purchases are *data-entry*. Mixing the two in tabs confuses users about which screen "owns" the number. |
| Under Inventory (godown user) | Rejected: vendor purchases carry invoice / GST / e-way-bill compliance weight — Admin territory. Inventory users may get a **read-only** "incoming deliveries" view later if useful. |

## 2. Screens (Admin)

1. **`/admin/vendors`** — Vendor master
   - List + Add/Edit dialog, same shape as `Shops.tsx`
   - Fields: `name`, `gstin`, `state`, `contact_phone`, `is_active`
   - `state` drives the auto-`is_interstate` flag on purchases

2. **`/admin/purchases`** — Purchase records list
   - Columns: code, vendor, godown, invoice #, invoice date, amount,
     status, interstate flag, "e-way bill" chip (Green = present, Amber =
     needed-but-missing, Grey = not required)
   - Filters: vendor, godown, from/to date range, status (Ordered /
     Received), interstate toggle, "e-way bill missing" quick filter
   - Excel export (mirrors ShopBreakdownTable's export pattern)

3. **`/admin/purchases/new`** and **`/admin/purchases/:id`** — Create /
   detail / edit
   - Vendor picker + destination godown picker
   - Invoice details (number, date, amount)
   - Line items grid: product picker (reuse `ShopRequestNew.tsx`'s picker),
     qty, unit cost
   - `is_interstate` auto-derived from `vendor.state`; NOT user-editable
   - **E-Way Bill section renders only when `is_interstate = true`**:
     EBN input, `valid_upto` date, file upload for EBN PDF/image
   - "Mark Received" button — disabled with tooltip if validation rule
     unmet (see §4)

## 3. Data model (new tables)

### `vendors`

| Column | Notes |
|---|---|
| `id`               (uuid, PK) | |
| `name`             (varchar) | |
| `gstin`            (varchar, nullable) | Unregistered vendors possible |
| `state`            (varchar, NOT NULL) | Drives interstate detection |
| `contact_phone`    (varchar, nullable) | |
| `is_active`        (bool, default true) | |
| `created_at`, `updated_at` | |

### `vendor_purchases` (header — mirrors `stock_requests` shape)

| Column | Notes |
|---|---|
| `id`, `code` (`PUR0001` — same seq pattern as `seq_request_code`) | |
| `vendor_id`         → vendors | |
| `godown_id`         → inventories | destination godown |
| `is_interstate`     (bool, derived at insert) | `vendor.state <> 'Tamil Nadu'` |
| `invoice_number`, `invoice_date`, `invoice_amount` | supplier's bill |
| `eway_bill_number`  (varchar, nullable) | the 12-digit EBN |
| `eway_bill_valid_upto` (date, nullable) | |
| `eway_bill_doc_url` (text, nullable) | uploaded copy — blob URL |
| `status`            (Ordered / Received) | mirrors request lifecycle |
| `total_items`, `total_qty`, `total_amount` | cached aggregates |
| `notes`             (varchar, nullable) | |
| `received_at`, `received_by` | populated on status → Received |
| `is_deleted`, `created_at`, `updated_at` | soft-delete pattern |

### `vendor_purchase_items`

| Column | Notes |
|---|---|
| `id`, `purchase_id` → vendor_purchases | |
| `product_id`        → products | |
| `qty`, `unit_cost` (snapshot) | Same rationale as `stock_request_items.unit_price` |
| `weight_value`, `weight_unit` (snapshot) | Frozen at purchase time |

### `app_settings` addition

| Key | Purpose |
|---|---|
| `eway_bill_threshold` (numeric, default `100000`) | GST Council revises periodically — editable from Admin Settings, no code change |

## 4. Business rule (the actual "e-way bill USAGE" point)

On any `vendor_purchases` transition to `Received`:

```
IF is_interstate = true
   AND invoice_amount > eway_bill_threshold
   AND (eway_bill_number IS NULL OR eway_bill_number = '')
THEN block the transition with a validation banner:
   "Interstate purchase over ₹1,00,000 needs an e-way bill number
    before it can be marked Received."
```

Enforced in the SP layer (`fn_vendor_purchase_receive`), so the FE gate
is defence-in-depth only. Same shape as the existing
`stock_requests` status-transition guards.

## 5. Impact on already-built screens

- **Accounts / Dashboard `purchaseAmount`** — currently computed as
  `Σ dispatched_qty × products.purchase_price` (a proxy — not a real
  purchase record). Once vendor_purchases exists, that figure switches
  over to `Σ vendor_purchases.invoice_amount WHERE status = 'Received'
  AND received_at BETWEEN from AND to`. Real cost basis, actual invoices,
  audit-trailable.
- **No FE changes needed** for Accounts / Dashboard beyond swapping the
  data source SP body — DTO shape stays identical (still a single
  `purchaseAmount` scalar per bucket).
- **E-Way Bill compliance surface** — the EBN itself doesn't appear in
  Accounts. It stays on the purchase record as an audit attachment (GST
  officer / auditor may ask for proof of transport).

## 6. Rollout — 3 sub-phases

### Phase 6a — Foundation (~1 week)

Vendor master + purchase records CRUD, **without e-way bill fields**.

- New tables: `vendors`, `vendor_purchases`, `vendor_purchase_items`
- SPs: `fn_vendor_*` CRUD family (create, get, list_paged, update,
  delete, receive)
- BE: repository + service + controller
- FE: `AdminVendors.tsx`, `AdminVendorPurchases.tsx`,
  `AdminVendorPurchaseNew.tsx`
- Client can immediately start recording all purchases (interstate +
  intrastate) — no compliance blocker yet

### Phase 6b — E-Way Bill fields (~3-4 days)

Add e-way bill fields + validation gate to already-shipped Phase 6a.

- ALTER TABLE adds `eway_bill_number`, `eway_bill_valid_upto`,
  `eway_bill_doc_url`
- `app_settings.eway_bill_threshold` seeded at ₹1,00,000
- `fn_vendor_purchase_receive` gains the interstate-threshold guard
- FE: conditional e-way-bill section on purchase form + status-chip in
  list view + file upload wiring
- **This is the 99% solution** — user pastes the EBN they generated on
  ewaybillgst.gov.in and uploads the copy

### Phase 6c — NIC API integration (later, optional)

Skip entirely for now.

- Needs GSP/ASP provider signup (Cygnet / Masters India / TaxPro etc.)
- API keys, sandbox testing, per-transaction fee
- Only worth it at 50+ interstate purchases / month — small-business
  clients typically stick with the manual portal
- If ever built, isolate as a `EwayBillClient` service the "Mark
  Received" flow can optionally invoke; keep the manual-entry path
  working alongside

## 7. Open decisions before Phase 6a starts

- **Purchase code prefix** — `PUR0001` single sequence, or per
  interstate/intrastate? **Recommendation: single `PUR0001`**, simpler.
- **File storage** — blob storage (Cosmos / Azure Blob / S3) for
  `eway_bill_doc_url`, or Postgres `bytea`? **Recommendation:** if blob
  isn't wired up elsewhere in the app yet, use `bytea` for Phase 6b and
  graduate to blob when a real blob-heavy feature justifies it.
- **Who can add vendors** — Admin only, or Admin + Inventory user?
  **Recommendation: Admin only.** Matches the financial-authority
  boundary already used for other master data.
- **Inventory user visibility** — read-only "Incoming Deliveries" view
  for inventory staff to see expected shipments? **Recommendation:
  Phase 6a Admin-only.** Revisit in 6b if inventory users ask for it.
- **When to build** — sequence recommendation: **finish POS Billing
  (Phase 5) first**, then Phase 6a. POS drives daily revenue capture
  (highest ROI); Purchases drives cost accuracy + compliance
  (important, not urgent).

## 8. What this reuses from existing codebase

- **Sequence-generated codes** — `seq_request_code` style (`PUR0001`)
- **Snapshot pricing** — `unit_cost` on line items, frozen at insert
- **Cached aggregates** — `total_items` / `total_qty` / `total_amount`
  kept in sync by SPs on insert/update
- **Soft-delete** — `is_deleted` flag, same pattern as everywhere
- **Status lifecycle guards** — SP layer enforces state transitions
- **`app_settings` master-switch** — same mechanism the POS plan uses
  for `pos_allow_oversell` / `request_lock_enabled`
- **Item picker** — reuse `ShopRequestNew.tsx`'s product picker as-is

None of this is a foreign concept — it's a Phase-6-shaped addition
using patterns the codebase already runs on.

## 9. Sources

- `DB/planned/eway_bill_interstate_purchase.md` — background reference
- `DB/planned/phase4_pos_billing.md` — POS plan (Phase 5 precedes this)
- ewaybillgst.gov.in — official portal
- cbic-gst.gov.in — CBIC GST portal
