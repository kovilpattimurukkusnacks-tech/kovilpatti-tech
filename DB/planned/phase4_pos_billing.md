# Phase 4 — POS Billing + Shop Inventory (planned)

**Status:** planned, not built. All forks resolved 09-Jul-2026.
**Scope:** production-grade retail POS at snack-chain scale.
**Hardware in scope:** barcode scanner + thermal printer already owned by the client.
**External integrations:** GSP for e-way bills (see Domain 6.7). Contract with a GST Suvidha Provider required before API code can ship.

---

## Locked-in decisions (from planning discussion, 09-Jul-2026)

| # | Question | Answer | Schema impact |
|---|---|---|---|
| 1 | Credit sales in v1? | **No** — v1 is cash / UPI / card only, always paid at issue | Payment fields on `bills` header; multi-tender via `bill_payments` |
| 2 | Physical stock-take workflow? | **Yes** — full session (Draft → Submitted) so cashier can pause | `shop_stock_takes` + `shop_stock_take_items` |
| 3 | Cancel/refund bill freely? | **Yes** — anytime, with audit trail | `bills.cancelled_*` cols + reversal movements |
| 4 | Real B2B customers + scanner? | **Yes** — B2B invoicing (IGST), barcode scan → line | `customer_gstin`, `customer_state_code`, IGST cols; `product_barcodes` table |
| 5 | Utilities / shop expenses screen? | **Yes** — rent, electricity, water, phone, purchases, repairs (client ask 09-Jul) | `expense_categories` + `shop_expenses`; auto-writes to `cash_movements` when Cash from till |
| 6 | E-way bill transaction? | **Yes — BOTH directions + GSP API integration** (client refined 09-Jul) | See revised Domain 6.7 — 4 tables: `vendors`, `vendor_shipments`, `eway_bills`, `eway_api_logs` |
| 7 | Cash register / shift sessions in v1? | **Yes** — till reconciliation is what makes a POS a POS (locked 09-Jul) | `cash_registers` + `cash_sessions` + `cash_movements` + `cash_denominations` all IN v1 |
| 8 | `tax_rates` master vs inline `products.gst`? | **Inline** — skip the master table (locked 09-Jul) | No `tax_rates` table; `products.gst` is the single source of GST rate per product |

---

## Reuse from existing schema (no changes)

| Piece | Where it lives | How Phase 4 uses it |
|---|---|---|
| Product master + MRP + purchase_price + GST% | `products` (phase 1) | Line-item pricing + tax |
| Shop master + GSTIN + gst_enabled | `shops` (phase 1) | Tax on / off per shop |
| Global GST toggle | `app_settings.gst_enabled` (phase 2) | Master switch |
| Cashier user | `users` (phase 1), ShopUser role | POS session ownership |
| Inbound receipts (seeds on-hand) | `stock_request_items.received_qty` (phase 2) | Initial `shop_inventory` seed |
| Godown → shop dispatch flow | `stock_requests` (phase 2) | Untouched — still owns inbound |

---

## Existing table CHANGES (not new tables)

### `shops` (+2 cols)
```sql
state_code           varchar(2)   NULL   -- backfill from GSTIN prefix
default_register_id  uuid         NULL   -- FK cash_registers, set post-create
```

### `app_settings` (+ new keys)
- `pos_thermal_width_mm` (default `'80'`)
- `bill_footer_text` (default `''`)
- `bill_show_barcode` (default `'true'`)
- `pos_round_off_enabled` (default `'true'`)
- `pos_low_stock_threshold` (default `'5'`)
- `eway_gsp_provider` (default `'None'`)                — one of None/ClearTax/IRIS/MastersIndia/WebTel/Cygnet/KDK/TaxPro
- `eway_gsp_base_url` (default `''`)                    — GSP API endpoint
- `eway_gsp_environment` (default `'Sandbox'`)          — 'Sandbox' | 'Production'
- `eway_gsp_username_ref` (default `''`)                — env-var/vault lookup key (NOT the credential itself)
- `eway_default_transport_mode` (default `'Road'`)

### `stock_requests_items` receiving trigger — new obligation
When shop confirms `received_qty`, a hook writes a `Receipt` row to `shop_inventory_movements` and updates `shop_inventory.on_hand + avg_cost`. Implemented in an SP called from the existing receive endpoint — no schema change to phase 2 tables.

---

## New tables — grouped by domain

### Domain 1 — Sales (6 tables)

**1. `bills`** — invoice header
- code (BILL0001 via `bill_code_seq`)
- shop_id, customer snapshot (name/phone/gstin/state), bill_type (Retail/B2B/ReturnBill), bill_date, status (Draft/Issued/Cancelled/Refunded)
- Money: sub_total, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, round_off, total_amount
- Payment summary: payment_status (Paid always in v1), amount_paid
- Notes, audit, cancellation trail
- Constraints: type/status enums, GSTIN length 15, tax split exclusivity (IGST xor CGST+SGST), amounts non-neg

**2. `bill_items`** — lines
- bill_id, product_id, sort_order (gap-tolerant)
- qty (numeric 12,3), unit_price snapshot
- discount_pct + discount_amount, line_subtotal
- gst_rate, cgst_amount, sgst_amount, igst_amount, line_total
- Constraints: gst_rate range, discount_pct 0-100, IGST exclusive of CGST/SGST

**3. `bill_payments`** — multi-tender
- bill_id, payment_mode (Cash/UPI/Card), amount, reference_no (UPI txn / card slip / cheque)
- Enables ₹300 cash + ₹700 UPI on one bill (real-world common case even without credit sales)

**4. `bill_returns`** — return header linked to original bill
- code (RET0001 via `return_code_seq`)
- original_bill_id FK, shop_id, return_date, reason
- refund totals + refund_mode
- status (Draft/Issued/Cancelled)
- Kept as separate table (not `bill_type='ReturnBill'`) so sales/GSTR-1 reports don't need filters everywhere; return goes into CDNR section of GST filing.

**5. `bill_return_items`** — which lines / qty returned
- bill_return_id, original_bill_item_id (nullable if standalone), product_id, qty, unit_price snapshot, tax split

**6. `bill_reprints`** — thermal reprint audit
- bill_id, reprinted_at, reprinted_by, reason (e.g. "customer lost receipt")
- Compliance: GST-registered shops must justify duplicate copies

### Domain 2 — Inventory (4 tables)

**7. `shop_inventory`** — standing on-hand per (shop, product)
- Composite PK (shop_id, product_id)
- on_hand numeric(12,3), avg_cost numeric(10,2), last_movement_at, updated_at
- Partial index for low-stock queries

**8. `shop_inventory_movements`** — signed ledger
- movement_type: Opening / Receipt / Sale / Return / Adjustment / Refund
- ref_type: Opening / StockRequest / Bill / StockTake / ManualAdjustment
- qty_delta (signed), qty_after (running balance snapshot)
- unit_cost (feeds avg_cost recalc on receipts)
- Indexes: (shop_id, product_id, created_at DESC), (ref_type, ref_id), created_at

**9. `shop_stock_takes`** — session header
- code (STK0001), shop_id, status (Draft/Submitted/Cancelled), started_at, submitted_at, notes
- Partial UNIQUE index: only one Draft per shop
- On Submit, SP writes one `shop_inventory_movements` row per non-zero diff

**10. `shop_stock_take_items`** — per-product count
- stock_take_id, product_id, system_qty snapshot, counted_qty
- qty_diff GENERATED ALWAYS AS (counted_qty - system_qty)
- UNIQUE (stock_take_id, product_id)

### Domain 3 — Product catalog (1 table)

**11. `product_barcodes`** — multi-code per product
- product_id, code (UNIQUE where not deleted), is_primary
- Partial UNIQUE index: one is_primary=true per product
- Supports variant packs (100g/200g different EAN) + reprint batches

### Domain 4 — Customers (1 table for v1)

**12. `customers`** — persistent master
- phone (natural key, UNIQUE), name, gstin (nullable), state_code (nullable)
- Enables phone-scan → auto-fill; report "sales by customer"
- `bills.customer_id` FK NULL — walk-ins skip the master, B2B links to it

`customer_addresses` deferred to v2 — walk-in retail doesn't need it; B2B addresses go on the bill snapshot for v1.

### Domain 5 — Cash management (4 tables) — CORE DIFFERENTIATOR

**13. `cash_registers`** — physical till per shop
- shop_id, name ("Front counter"), active
- Usually 1 per shop, but schema supports 2 for peak-hour shops

**14. `cash_sessions`** — cashier shift
- register_id, cashier_user_id, opened_at, closed_at, status (Open/Closed)
- opening_cash, closing_cash_counted, expected_cash (from bills + movements), shortage_or_excess (generated)
- Partial UNIQUE: only one Open session per register
- Answers "why is till ₹340 short today?" — hard requirement for GST-registered retail

**15. `cash_movements`** — non-bill cash in/out during session
- session_id, movement_type (PayIn/PayOut/Drop), amount, reason, at_time, by_user
- Records: pay ₹200 to delivery boy, put ₹500 change from bank, owner takes ₹5000 drop

**16. `cash_denominations`** — denomination breakdown at session open + close
- session_id, timing (Open/Close), denom_500, denom_200, denom_100, denom_50, denom_20, denom_10, denom_coins
- One row per (session, timing) — 2 rows per session max
- Total should equal opening_cash / closing_cash_counted on the session row

### Domain 6.5 — Shop expenses / utilities (2 tables) — added 09-Jul-2026 per client

Rationale: client pays rent, electricity, water, phone, repairs, and buys shop-side items (fan, chair, cleaning supplies). They want a screen to record every disbursement. Ties into cash session ledger so till cash reconciles at day close. Enables a proper P&L per shop (Revenue − COGS − OPEX).

**19. `expense_categories`** — small code table
- id smallint PK, code varchar(30) UNIQUE, name varchar(60), sort_order, active, is_deleted, audit
- Seeded rows: RENT, ELECTRICITY, WATER, PHONE_INTERNET, PURCHASE, REPAIR, SALARY, CLEANING, TRANSPORT, MISC
- Admin can add categories via a code-tables screen (like City / Category in phase 1)

**20. `shop_expenses`** — the transaction record
- id uuid PK, code varchar(20) UNIQUE (EXP0001 via `expense_code_seq`)
- shop_id FK, category_id FK expense_categories
- expense_date date, payee_name varchar(120) — "TNEB" / "Building owner Ramesh" / "Ramesh Electronics"
- description text — "May 2026 rent" / "Bought desk fan"
- amount numeric(12,2), gst_amount numeric(12,2) DEFAULT 0 (future ITC claim)
- payment_mode varchar(20) — Cash / UPI / Bank / Card
- payment_reference varchar(40) NULL — UPI txn / cheque no
- paid_from_session_id uuid NULL FK cash_sessions — set when Cash from till
- attachment_url text NULL — pointer to uploaded bill photo (S3 / blob storage)
- notes text
- status varchar(20) — 'Recorded' / 'Cancelled'
- is_deleted, audit cols, cancellation trail (cancelled_at/by/reason)
- Constraint: if payment_mode='Cash' AND paid_from_session_id IS NOT NULL, an SP writes a `cash_movements` row with type='PayOut' referencing this expense — so till cash matches sales−payouts.

Deferred to v2: `expense_recurring_schedules` (rent-remind-me-monthly), `expense_attachments` polymorphic table if one expense needs multiple photos.

### Domain 6.7 — E-way bills + vendors + GSP API integration (4 tables) — refined 09-Jul-2026

**Refined scope (client, 09-Jul-2026):**
- E-way bills flow **BOTH directions**:
  - **Inbound**: vendors from all over India ship raw materials / goods → they generate e-way on GST portal → we record the EWB against the vendor shipment
  - **Outbound**: our godown → shops (interstate branches) OR our shop → B2B customer (>₹50k) → we generate the e-way
- **API integration required** — app talks to a GSP (GST Suvidha Provider) to auto-generate outbound EWBs and auto-fetch inbound EWB details by number.

**Business prerequisite (blocks API code):**
- Contract with a GSP: ClearTax / IRIS Sapphire / Masters India / WebTel / Cygnet / KDK / TaxPro
- Cost: ~₹5k–50k setup + ~₹2k–10k/month + ~₹0.30–2 per e-way
- Get sandbox creds → onboard → prod creds. Only then can API code go live.

**Rollout plan:**
- **Phase 4a (ships without GSP contract):** Record-mode — user generates on portal manually, keys in the fields + uploads PDF. `generated_via='Manual'`.
- **Phase 4b (adds GSP integration):** "Generate" button calls GSP API and returns EWB number auto; "Fetch by number" auto-fills inbound e-way from vendor-supplied EWB number. `generated_via='API'`. Same tables serve both phases — no migration needed.

---

**21. `vendors`** — bare-bones master (full procurement stays in Phase 5)
```
id            uuid PK
code          varchar(20) UNIQUE            -- VEN0001 via vendor_code_seq
name          varchar(120) NOT NULL
gstin         varchar(15) NULL
state_code    varchar(2)  NULL              -- backfill from GSTIN prefix when present
address       text
contact_person varchar(120)
contact_phone varchar(20)
email         varchar(120)
active        boolean NOT NULL DEFAULT true
is_deleted    boolean NOT NULL DEFAULT false
audit cols

CONSTRAINT chk_vendors_gstin_length CHECK (gstin IS NULL OR length(gstin) = 15)

CREATE INDEX idx_vendors_active ON vendors(active) WHERE is_deleted = false
CREATE INDEX idx_vendors_gstin  ON vendors(gstin)  WHERE gstin IS NOT NULL
```

**22. `vendor_shipments`** — inbound header (anchor for inbound e-way records)
```
id                uuid PK
code              varchar(20) UNIQUE         -- SHIP0001 via vendor_shipment_code_seq
vendor_id         uuid NOT NULL FK vendors
shipment_date     date NOT NULL
description       text                        -- freeform "20 bags maida, 5 tins oil"
taxable_amount    numeric(12,2) NOT NULL DEFAULT 0
total_amount      numeric(12,2) NOT NULL DEFAULT 0
delivery_location varchar(120)                -- "Kovilpatti godown"
status            varchar(20) NOT NULL DEFAULT 'Expected'
received_at       timestamptz NULL
notes             text
is_deleted        boolean NOT NULL DEFAULT false
audit cols

CONSTRAINT chk_vendor_shipments_status
  CHECK (status IN ('Expected','Received','Cancelled'))
CONSTRAINT chk_vendor_shipments_received_pair
  CHECK ((status = 'Received') = (received_at IS NOT NULL))

CREATE INDEX idx_vendor_shipments_vendor_date ON vendor_shipments(vendor_id, shipment_date DESC)
CREATE INDEX idx_vendor_shipments_status      ON vendor_shipments(status) WHERE is_deleted = false
```
Header only for v1 — no line items. Full procurement / GRN with line-level received qty stays Phase 5. Phase 4 inbound e-way tracking anchors here as a compliance record without needing inventory impact.

**23. `eway_bills`** — restructured to support both directions + GSP metadata
```
id                    uuid PK
eway_number           varchar(20) NOT NULL         -- 12-digit portal number
generation_date       timestamptz

direction             varchar(10) NOT NULL         -- 'Inbound' | 'Outbound'

-- Parent link (exactly ONE populated based on direction)
stock_request_id      uuid NULL FK stock_requests    -- outbound → shop
bill_id               uuid NULL FK bills             -- outbound → B2B customer (>=₹50k)
vendor_shipment_id    uuid NULL FK vendor_shipments  -- inbound ← vendor

-- Supply classification (portal fields)
supply_type           varchar(20)   -- 'Outward' | 'Inward'
sub_type              varchar(30)   -- 'Supply' | 'Return' | 'BranchTransfer' | 'JobWork'
document_type         varchar(20)   -- 'TaxInvoice' | 'BillOfSupply' | 'DeliveryChallan'
document_number       varchar(40)
document_date         date

-- From / To
from_gstin            varchar(15)
from_state_code       varchar(2)
from_address          text
to_gstin              varchar(15)
to_state_code         varchar(2)
to_address            text

-- Transport
transport_mode        varchar(20)   -- 'Road' | 'Rail' | 'Air' | 'Ship'
distance_km           smallint
transporter_name      varchar(120)
transporter_id        varchar(15)  NULL
transporter_doc_no    varchar(40)  NULL
transporter_doc_date  date         NULL
vehicle_number        varchar(20)
vehicle_type          varchar(20)   -- 'Regular' | 'ODC'

-- Money
taxable_amount        numeric(12,2)
cgst_amount           numeric(12,2) DEFAULT 0
sgst_amount           numeric(12,2) DEFAULT 0
igst_amount           numeric(12,2) DEFAULT 0
total_amount          numeric(12,2)

-- Validity + status
valid_from            timestamptz
valid_until           timestamptz              -- portal computes from distance
status                varchar(20)              -- 'Draft' | 'Generated' | 'Cancelled' | 'Expired'
cancellation_reason   text NULL
cancelled_at, cancelled_by

-- GSP integration metadata (Phase 4b hooks; Phase 4a leaves NULL / 'Manual')
generated_via         varchar(20) DEFAULT 'Manual'  -- 'Manual' | 'API'
gsp_request_id        varchar(50) NULL              -- correlation id from GSP call
gsp_response_status   varchar(20) NULL              -- 'Success' | 'Failed' | 'Pending'

attachment_url        text NULL                     -- Portal PDF blob URL
notes                 text
audit cols

CONSTRAINT chk_eway_bills_direction
  CHECK (direction IN ('Inbound','Outbound'))
CONSTRAINT chk_eway_bills_status
  CHECK (status IN ('Draft','Generated','Cancelled','Expired'))
CONSTRAINT chk_eway_bills_transport_mode
  CHECK (transport_mode IN ('Road','Rail','Air','Ship'))
CONSTRAINT chk_eway_bills_gstin_lengths
  CHECK ((from_gstin IS NULL OR length(from_gstin) = 15)
     AND (to_gstin   IS NULL OR length(to_gstin)   = 15))
CONSTRAINT chk_eway_bills_tax_exclusive
  CHECK (NOT (igst_amount > 0 AND (cgst_amount > 0 OR sgst_amount > 0)))
CONSTRAINT chk_eway_bills_generated_via
  CHECK (generated_via IN ('Manual','API'))

-- Direction ↔ parent-FK integrity: exactly one parent per direction
CONSTRAINT chk_eway_bills_direction_ref CHECK (
  (direction = 'Outbound'
   AND vendor_shipment_id IS NULL
   AND ((stock_request_id IS NOT NULL) <> (bill_id IS NOT NULL))    -- xor
  )
  OR
  (direction = 'Inbound'
   AND stock_request_id IS NULL
   AND bill_id IS NULL
   AND vendor_shipment_id IS NOT NULL
  )
)

CREATE UNIQUE INDEX uq_eway_bills_number_active
  ON eway_bills(eway_number) WHERE status <> 'Cancelled'
CREATE INDEX idx_eway_bills_direction_date ON eway_bills(direction, generation_date DESC)
CREATE INDEX idx_eway_bills_stock_request  ON eway_bills(stock_request_id)  WHERE stock_request_id  IS NOT NULL
CREATE INDEX idx_eway_bills_bill           ON eway_bills(bill_id)           WHERE bill_id           IS NOT NULL
CREATE INDEX idx_eway_bills_vendor_shipmt  ON eway_bills(vendor_shipment_id) WHERE vendor_shipment_id IS NOT NULL
```

**Relationship semantics** — one parent record (stock_request / bill / vendor_shipment) can have **multiple** e-way bills (split-vehicle dispatch, staged shipments), so the FK is on this side. Typically 1:1.

**24. `eway_api_logs`** — audit trail of every GSP API call (Phase 4b, but table exists from day 1)
```
id                uuid PK
eway_bill_id      uuid FK eway_bills NULL      -- NULL if call failed before local record was written
gsp_endpoint      varchar(60) NOT NULL         -- 'Generate' | 'Fetch' | 'Cancel' | 'UpdateVehicle' | 'ExtendValidity' | 'RejectEwb'
request_body      jsonb NOT NULL               -- redacted — no credentials
response_body     jsonb
http_status       smallint
error_message     text NULL
called_at         timestamptz NOT NULL DEFAULT now()
called_by         uuid FK users ON DELETE SET NULL

CREATE INDEX idx_eway_api_logs_eway     ON eway_api_logs(eway_bill_id)  WHERE eway_bill_id IS NOT NULL
CREATE INDEX idx_eway_api_logs_endpoint ON eway_api_logs(gsp_endpoint, called_at DESC)
CREATE INDEX idx_eway_api_logs_time     ON eway_api_logs(called_at DESC)
```
Non-negotiable for compliance disputes — "GSP claims success, portal doesn't show the e-way, who's right?" Log settles it.

**Credentials handling — NOT in the DB:**
- GSP username / password / API keys live in **env vars** (or Azure Key Vault / AWS Secrets Manager) — never in `app_settings` in plaintext
- `app_settings` only tracks non-secret config: `eway_gsp_provider`, `eway_gsp_base_url`, `eway_gsp_environment` ('Sandbox' | 'Production'), `eway_gsp_username_ref` (a lookup key, not the value)

### Domain 7 — Ops & auditing (2 tables + settings)

**17. `number_series`** — central prefix + counter config
- entity ('bill', 'return', 'stock_take', 'stock_adjustment')
- prefix ('BILL', 'RET', 'STK', 'ADJ'), padding (4), next_value
- Alternative to sequences — single admin screen to reset/change series per financial year

**18. `audit_log`** — polymorphic action trail
- entity_type + entity_id, action ('cancel','override_price','stock_take_submit',…)
- actor_user_id, at_time, before_json, after_json, reason
- Separate from existing per-domain audit tables — general-purpose for POS ops that don't have a dedicated table

---

## Domains DEFERRED to v2 / v3

| Domain | Tables | Why deferred |
|---|---|---|
| Loyalty | `loyalty_accounts`, `loyalty_transactions` | Client hasn't asked; big UX module |
| Promotions | `promotions`, `promotion_products` | Rule engine adds complexity; discount fields on `bills` already support ad-hoc discounts |
| Coupons | `coupons`, `coupon_redemptions` | Same as promotions |
| Advance orders | `customer_orders`, `customer_order_items` | Ask client about Diwali gift-box pre-orders — if real, promote to v1 |
| Gift cards | `gift_cards`, `gift_card_txns` | Rarely needed for snack retail |
| Customer addresses | `customer_addresses` | B2B addresses live on bill snapshot in v1 |
| Tax rate master | `tax_rates` | `products.gst` inline is enough for a snack shop |
| Purchase orders | `purchase_orders`, `supplier_master`, `goods_receipt_notes` | Godown → shop flow (phase 2) covers inbound |
| Recurring expenses schedule | `expense_recurring_schedules` | v1 records each expense manually; automate later if client asks for "remind me to pay rent" |
| Transporter master | `transporters` | v1 keeps transporter name freeform on `eway_bills`; promote to a picker when the client has 3+ recurring transporters |
| Multi-attachment | `attachments` (polymorphic) | v1 stores one `attachment_url` per expense / e-way; promote if a single record needs multiple photos |
| Godown/inventory expenses | `inventory_expenses` (or entity_type on expenses) | v1 tracks shop expenses only per client scope. Add a second table (or entity_type col) when godown OPEX is needed for consolidated P&L |
| Full procurement (POs, GRNs, supplier bills, supplier payments) | `purchase_orders`, `purchase_order_items`, `goods_receipt_notes`, `supplier_bills`, `supplier_payments` | Phase 5. v1 has only `vendors` + `vendor_shipments` (header) as an FK anchor for inbound e-way — line-level GRN + AP ledger stays Phase 5 |

---

## Sequences

```sql
CREATE SEQUENCE bill_code_seq             START 1;   -- BILL0001
CREATE SEQUENCE return_code_seq           START 1;   -- RET0001
CREATE SEQUENCE stock_take_code_seq       START 1;   -- STK0001
CREATE SEQUENCE expense_code_seq          START 1;   -- EXP0001
CREATE SEQUENCE vendor_code_seq           START 1;   -- VEN0001
CREATE SEQUENCE vendor_shipment_code_seq  START 1;   -- SHIP0001
```
Bill / return / stock-take / expense / vendor / shipment codes generated via DEFAULT on the code column. `number_series` table (T17) is admin-facing metadata — the sequences are the actual counter engine. E-way bill numbers are NOT sequenced locally — they come from the GST portal (Phase 4a: keyed in manually; Phase 4b: returned from GSP API) and are stored as-is on `eway_bills.eway_number`.

---

## Migration order in `phase4_init.sql`

1. Add `shops.state_code`, `shops.default_register_id`
2. Backfill `shops.state_code` from `substring(gstin, 1, 2)`
3. Create sequences
4. Create `product_barcodes` (needed as FK anchor by nothing, but declared early)
5. Create `customers`
6. Create `cash_registers` → `cash_sessions` → `cash_movements` → `cash_denominations`
7. Set `shops.default_register_id` FK constraint (deferred until `cash_registers` exists)
8. Create `shop_inventory` → `shop_inventory_movements`
9. **Seed** `shop_inventory` from `stock_request_items.received_qty` sums per (shop_id, product_id)
10. **Seed** `shop_inventory_movements` — one 'Opening' row per (shop, product) with the seeded on_hand
11. Create `bills` → `bill_items` → `bill_payments`
12. Create `bill_returns` → `bill_return_items` → `bill_reprints`
13. Create `shop_stock_takes` → `shop_stock_take_items`
14. Create `expense_categories`, seed default rows (RENT, ELECTRICITY, WATER, PHONE_INTERNET, PURCHASE, REPAIR, SALARY, CLEANING, TRANSPORT, MISC)
15. Create `shop_expenses`
16. Create `vendors` (FK-anchor for inbound e-way)
17. Create `vendor_shipments` (inbound header)
18. Create `eway_bills` (both-direction, GSP-metadata-aware)
19. Create `eway_api_logs`
20. Create `number_series`, seed with initial rows (bill, return, stock_take, expense, vendor, vendor_shipment)
21. Create `audit_log`
22. Insert `app_settings` rows for POS + GSP knobs (creds themselves go to env / Key Vault, NOT here)

---

## SPs to plan for `phase4_procedures.sql`

**Barcode / lookup**
- `fn_product_lookup_by_barcode(code)` — POS scan path

**Bill lifecycle**
- `fn_bill_create(shop_id, items[], customer, tenders[], ...)` — atomic: bill + items + payments + inventory movements
- `fn_bill_cancel(bill_id, reason)` — reversal movements + Cancelled status
- `fn_bill_search(shop_id, code, from, to, status, page)`
- `fn_bill_reprint(bill_id, reason)` — writes `bill_reprints` audit row

**Returns**
- `fn_bill_return_create(original_bill_id, items[], refund_mode, ...)` — writes return + return items + return movements + refund payment
- `fn_bill_return_cancel(return_id, reason)`

**Inventory**
- `fn_shop_inventory_on_hand(shop_id, search, page)` — cream ledger view
- `fn_shop_inventory_movements(shop_id, product_id, from, to, page)` — audit drill-down
- `fn_shop_inventory_low_stock(shop_id, threshold)` — reorder suggestions

**Stock-take**
- `fn_stock_take_start(shop_id)` — creates Draft session, snapshots system_qty per product
- `fn_stock_take_upsert_line(stock_take_id, product_id, counted_qty, note)`
- `fn_stock_take_submit(stock_take_id)` — writes Adjustment movements for non-zero diffs
- `fn_stock_take_cancel(stock_take_id, reason)`

**Cash**
- `fn_cash_session_open(register_id, cashier_user_id, opening_cash, denominations)`
- `fn_cash_session_close(session_id, closing_cash_counted, denominations)` — computes expected_cash + shortage/excess
- `fn_cash_movement_record(session_id, type, amount, reason)`

**Customer**
- `fn_customer_lookup_by_phone(phone)`
- `fn_customer_upsert(phone, name, gstin?, state_code?)`

**Expenses (Domain 6.5)**
- `fn_expense_categories_list()` — powers the category dropdown
- `fn_expense_category_upsert(id?, code, name, sort_order)` — admin management
- `fn_expense_create(shop_id, category_id, expense_date, payee_name, amount, gst_amount, payment_mode, payment_reference?, description?, session_id?, attachment_url?)` — atomic: expense + cash_movement (if Cash from till)
- `fn_expense_cancel(id, reason)` — reverses cash_movement, marks Cancelled
- `fn_expense_search(shop_id, category_id?, from, to, search?, page, page_size)`
- `fn_expense_summary(shop_id, from, to)` — category-wise rollup for the period

**Vendors + Vendor shipments (Domain 6.7)**
- `fn_vendor_upsert(id?, name, gstin?, state_code?, address, contact_person, contact_phone, email)`
- `fn_vendor_search(search?, active?, page, page_size)`
- `fn_vendor_shipment_create(vendor_id, shipment_date, description, taxable_amount, total_amount, delivery_location, notes)`
- `fn_vendor_shipment_mark_received(id, received_at)` — status Expected → Received
- `fn_vendor_shipment_cancel(id, reason)`
- `fn_vendor_shipment_search(vendor_id?, from, to, status?, page, page_size)`

**E-way bills (Domain 6.7) — same SPs serve Phase 4a manual + Phase 4b API**
- `fn_eway_bill_record(direction, parent_ref_type, parent_ref_id, eway_number, generation_date, ...all portal fields..., generated_via='Manual')` — used by both flows; Phase 4a keys everything, Phase 4b passes API-returned values
- `fn_eway_bill_update(id, transporter_*, vehicle_number, ...)` — vehicle / transporter change mid-transit
- `fn_eway_bill_cancel(id, reason)` — GST portal allows cancellation within 24h; local record mirrors
- `fn_eway_bill_get_by_number(eway_number)` — dedupe lookup before insert
- `fn_eway_bill_list_by_parent(parent_ref_type, parent_ref_id)` — list all e-way bills for a dispatch / bill / vendor_shipment
- `fn_eway_bill_search(direction?, shop_id?, from, to, status?, generated_via?, search?, page, page_size)`

**E-way GSP API logs**
- `fn_eway_api_log_write(eway_bill_id?, endpoint, request_body, response_body, http_status, error_message)` — audit every GSP call
- `fn_eway_api_log_search(endpoint?, eway_bill_id?, from, to, page)` — investigation queries

**Reports**
- `fn_report_daily_sales(shop_id, date)` — bills issued, revenue, tax split, top products
- `fn_report_gst_summary(shop_id?, from, to)` — GSTR-1 grouping
- `fn_report_bill_history(shop_id, customer_id?, from, to)`
- `fn_report_expense_monthly(shop_id, month)` — category-wise expense breakdown
- `fn_report_profit_loss(shop_id, from, to)` — Revenue − COGS − OPEX = Net Profit
- `fn_report_eway_register(shop_id?, from, to)` — inbound movement compliance register

---

## All forks resolved as of 09-Jul-2026

Both open forks decided — plan is locked, ready for DDL:

1. **Cash register / shift sessions in v1** → **YES** — Domain 6 stays in v1 (4 tables)
2. **`tax_rates` master vs inline `products.gst`** → **INLINE** — `products.gst` is the source of truth; no `tax_rates` table

Final table count: **24 new tables + 2 col adds on `shops` + 10 `app_settings` keys + 6 sequences**. Deferred domains listed above stay deferred to v2+ unless the client raises them.

**E-way scope was expanded 09-Jul-2026** after client confirmed:
- Both directions in scope (Inbound from vendors nationwide + Outbound to shops / B2B customers)
- GSP API integration required (Phase 4b — needs GSP contract before code)
- Phase 4a ships in manual-record mode; Phase 4b flips `generated_via` to 'API' once GSP is wired. Same tables — no migration between phases.

**Non-DB pre-req for Phase 4b:** business signs a GSP contract (ClearTax / IRIS / Masters India / etc.), obtains sandbox creds, then prod creds. Credentials live in env / Key Vault, never in DB.

---

## Table count summary

| Layer | New tables |
|---|---|
| Domain 1 — Sales | 6 |
| Domain 2 — Inventory | 4 |
| Domain 3 — Barcodes | 1 |
| Domain 4 — Customers | 1 |
| Domain 6 — Cash | 4 (pending fork #1) |
| Domain 6.5 — Shop expenses / utilities | 2 |
| Domain 6.7 — E-way + vendors + GSP logs | 4 |
| Domain 7 — Ops | 2 |
| **Total (v1)** | **24 new tables** |
| + Column additions on `shops` | 2 |
| + `app_settings` keys | 10 (5 POS + 5 GSP config) |
| + New sequences | 6 |

---

## File organisation when built

```
DB/phase4/
  phase4_init.sql          -- DDL: all 18 tables + col adds + seeds
  phase4_procedures.sql    -- All SPs listed above
  phase4_seed.sql          -- Opening seed for shop_inventory from phase 2 receipts
```

Optionally, split further if `phase4_init.sql` grows past ~800 lines:
```
  phase4_init_sales.sql        -- Domain 1 + 3 + 4
  phase4_init_inventory.sql    -- Domain 2
  phase4_init_cash.sql         -- Domain 6
  phase4_init_ops.sql          -- Domain 7
```
Prefer single file for now, split later only if reading it becomes painful.

---

## Cross-references

- Phase 1 schema: `DB/phase1/phase1_init.sql`
- Phase 2 (stock requests): `DB/phase2/phase2_init.sql`
- Phase 3 (accounts reports, no tables): `DB/phase3/phase3_init.sql`
- Retired plans: `DB/planned/backorder_requests.retired-2026-07-06.md`
