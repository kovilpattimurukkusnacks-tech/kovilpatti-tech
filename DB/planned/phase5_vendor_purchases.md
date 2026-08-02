# Phase 5 — Vendor Purchases + E-Way Bill Integration

> Concrete implementation plan for the vendor-purchases module (with e-way
> bill capture) proposed in `eway_bill_interstate_purchase.md`. That doc
> covers the *what* and *why* of e-way bills; this doc covers the *how* and
> *where* in the codebase — screens, tables, rollout order, and open
> decisions.
>
> Scheduled AFTER Phase 4 (POS Billing). Rationale: POS drives daily
> revenue capture (client's biggest ROI ask); Purchases drives cost
> accuracy + GST compliance (important but not blocking day-to-day
> operations).
>
> **24-Jul-2026 — reconciled with `phase4_pos_billing.md` Domain 6.7.**
> This module was originally drafted as a standalone "Phase 6" without
> checking Domain 6.7, which already designs `vendors` + `eway_bills` +
> `eway_api_logs`. It's renumbered to **Phase 5** (the name
> `phase4_pos_billing.md` itself reserves for this scope), reuses the
> existing `vendors` table instead of recreating it, and reuses the
> existing `eway_bills` table instead of a second e-way mechanism. See
> `phase5_reconciliation_notes.md` for the full before/after. The former
> `vendor_shipments` (Domain 6.7's header-only inbound stand-in, never
> built) is retired — `vendor_purchases` below is its replacement.

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
   - Fields: `name`, `gstin`, `state_code`, `contact_phone`, `active` (matches the `vendors` table Phase 4 Domain 6.7 already defines — see §3)
   - `state_code` drives the auto-`is_interstate` flag on purchases
   - If Phase 4 has already shipped Domain 6.7's `vendors` table, this screen is just the first UI built against it. If Phase 5 ships first (the likely order today), this screen's backing SPs create it.

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
   - `is_interstate` auto-derived from `vendor.state_code <> '33'` (Tamil
     Nadu's GST state code); NOT user-editable
   - **E-Way Bill section renders only when `is_interstate = true`**:
     EBN input, `valid_upto` date, file upload for EBN PDF/image — these
     write to `eway_bills` (via `fn_eway_bill_record`), not to columns on
     `vendor_purchases` itself (see §3/§4)
   - "Mark Received" button — disabled with tooltip if validation rule
     unmet (see §4)

## 3. Data model

### `vendors` — reused, not recreated

Already specced in `phase4_pos_billing.md` Domain 6.7 (T21). Phase 5 does
**not** redesign this table. Key columns for this doc's purposes:
`code` (`VEN0001`), `name`, `gstin`, **`state_code`** (2-digit GST state
code — not a free-text state name), `active`, `is_deleted`.
`is_interstate` on `vendor_purchases` derives as
`vendors.state_code <> '33'`.

### `vendor_purchases` (header — replaces the never-built `vendor_shipments`)

| Column | Notes |
|---|---|
| `id`, `code` (`PUR0001` — own sequence, see §7) | |
| `vendor_id`         → vendors | |
| `godown_id`         → inventories | destination godown |
| `is_interstate`     (bool, derived at insert) | `vendor.state_code <> '33'` |
| `invoice_number`, `invoice_date`, `invoice_amount` | supplier's bill |
| `status`            (Ordered / Received) | mirrors request lifecycle |
| `total_items`, `total_qty`, `total_amount` | cached aggregates |
| `notes`             (varchar, nullable) | |
| `received_at`, `received_by` | populated on status → Received |
| `is_deleted`, `created_at`, `updated_at` | soft-delete pattern |

**No e-way columns here.** E-way bill data (EBN, validity, transport
detail, GSP metadata) lives entirely in the existing `eway_bills` table
(Phase 4 Domain 6.7, T22), which gets a `vendor_purchase_id` FK — see
`phase4_pos_billing.md`'s Domain 6.7 section for the full column list.
One `vendor_purchases` row can have multiple `eway_bills` rows (split
shipments), same relationship shape `eway_bills` already uses for
`stock_request_id`/`bill_id`.

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
| `eway_bill_threshold` (numeric) | GST Council revises periodically — editable from Admin Settings, no code change. **Default value not yet confirmed** — `phase4_pos_billing.md` references ₹50,000 for outbound B2B; this doc originally proposed ₹1,00,000 for inbound interstate. Don't seed either number until the client confirms whether inbound/outbound share one threshold or need separate keys. See `phase5_reconciliation_notes.md` Decision 5. |

## 4. Business rule (the actual "e-way bill USAGE" point)

On any `vendor_purchases` transition to `Received`:

```
IF is_interstate = true
   AND invoice_amount > eway_bill_threshold
   AND NOT EXISTS (
     SELECT 1 FROM eway_bills
     WHERE vendor_purchase_id = this purchase's id
       AND direction = 'Inbound'
       AND status = 'Generated'
   )
THEN block the transition with a validation banner:
   "Interstate purchase over ₹<threshold> needs an e-way bill number
    before it can be marked Received."
```

Enforced in the SP layer (`fn_vendor_purchase_receive`), which calls into
the existing `fn_eway_bill_record`/lookup SPs from Phase 4 Domain 6.7
rather than inventing a parallel check. The FE gate is defence-in-depth
only. Same shape as the existing `stock_requests` status-transition
guards.

## 5. Impact on already-built screens

- **Accounts / Dashboard `purchaseAmount`** — currently computed as
  `Σ dispatched_qty × products.purchase_price` (a proxy — not a real
  purchase record). Once `vendor_purchases` exists, that figure switches
  over to `Σ vendor_purchases.invoice_amount WHERE status = 'Received'
  AND received_at BETWEEN from AND to`. Real cost basis, actual invoices,
  audit-trailable.
- **No FE changes needed** for Accounts / Dashboard beyond swapping the
  data source SP body — DTO shape stays identical (still a single
  `purchaseAmount` scalar per bucket).
- **E-Way Bill compliance surface** — the EBN itself doesn't appear in
  Accounts. It stays on `eway_bills` as an audit attachment (GST officer /
  auditor may ask for proof of transport), same as outbound e-way bills
  already do.

## 6. Rollout — 3 sub-phases

### Phase 5a — Foundation (~1 week)

Vendor master (if not already shipped by Phase 4) + purchase records CRUD,
**without e-way bill wiring**.

- New tables: `vendor_purchases`, `vendor_purchase_items` (+ `vendors` only
  if Phase 4 Domain 6.7 hasn't shipped yet)
- If Phase 4 has already shipped: ALTER `eway_bills` to attach the
  `vendor_purchase_id` FK constraint (column already exists per Phase 4's
  migration — see `phase4_pos_billing.md`)
- SPs: `fn_vendor_purchase_*` CRUD family (create, get, list_paged, update,
  delete, receive)
- BE: repository + service + controller
- FE: `AdminVendors.tsx` (if not already shipped), `AdminPurchases.tsx`,
  `AdminPurchaseNew.tsx`
- Client can immediately start recording all purchases (interstate +
  intrastate) — no compliance blocker yet

### Phase 5b — E-Way Bill wiring (~3-4 days)

Wire the existing `eway_bills` machinery to `vendor_purchases` +
validation gate.

- `app_settings.eway_bill_threshold` seeded once Decision 5 (§3) is
  confirmed
- `fn_vendor_purchase_receive` gains the interstate-threshold guard from
  §4, calling the shared `fn_eway_bill_record`/`fn_eway_bill_search` SPs
- FE: conditional e-way-bill section on the purchase form (writes through
  to `eway_bills`, not to `vendor_purchases`) + status-chip in list view +
  file upload wiring (reuses `eway_bills.attachment_url`)
- **This is the 99% solution** — user pastes the EBN they generated on
  ewaybillgst.gov.in and uploads the copy

### Phase 5c — NIC API integration (later, optional)

Skip entirely for now. Simpler than originally scoped because
`eway_bills` already carries the GSP metadata columns
(`generated_via`, `gsp_request_id`, `gsp_response_status`) and
`eway_api_logs` from Phase 4 Domain 6.7 — this phase just needs to start
populating them for the Inbound direction too, not build new
infrastructure.

- Needs GSP/ASP provider signup (Cygnet / Masters India / TaxPro etc.)
- API keys, sandbox testing, per-transaction fee
- Only worth it at 50+ interstate purchases / month — small-business
  clients typically stick with the manual portal
- Reuses the `EwayBillClient`-shaped integration Phase 4b already builds
  for outbound; keep the manual-entry path working alongside

## 7. Open decisions before Phase 5a starts

- **Purchase code prefix** — `PUR0001` single sequence, or per
  interstate/intrastate? **Recommendation: single `PUR0001`**, simpler.
- **File storage** — blob storage (Cosmos / Azure Blob / S3) for
  `eway_bills.attachment_url`, or Postgres `bytea`? Same open question
  Phase 4 Domain 6.7 already has for outbound e-way — resolve once, applies
  to both directions. **Recommendation:** if blob isn't wired up elsewhere
  in the app yet, use `bytea` and graduate to blob when a real
  blob-heavy feature justifies it.
- **`eway_bill_threshold` value(s)** — **not yet confirmed.** See §3 and
  `phase5_reconciliation_notes.md` Decision 5. This is the one open item
  that isn't a mechanical schema call — needs client/GST-rule
  confirmation before `app_settings` is seeded.
- **Who can add vendors** — Admin only, or Admin + Inventory user?
  **Recommendation: Admin only.** Matches the financial-authority
  boundary already used for other master data.
- **Inventory user visibility** — read-only "Incoming Deliveries" view
  for inventory staff to see expected shipments? **Recommendation:
  Phase 5a Admin-only.** Revisit in 5b if inventory users ask for it.

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
- **E-way bill capture** — reuses Phase 4 Domain 6.7's `eway_bills` +
  `eway_api_logs` wholesale (both directions share one table); no
  parallel EBN storage on `vendor_purchases`

None of this is a foreign concept — it's a Phase-5-shaped addition
using patterns the codebase already runs on.

## 9. Sources

- `DB/planned/eway_bill_interstate_purchase.md` — background reference
- `DB/planned/phase4_pos_billing.md` — POS plan + Domain 6.7 (`vendors`,
  `eway_bills`, `eway_api_logs`), which this doc extends
- `DB/planned/phase5_reconciliation_notes.md` — the numbering/schema
  reconciliation this doc was rewritten from
- ewaybillgst.gov.in — official portal
- cbic-gst.gov.in — CBIC GST portal
