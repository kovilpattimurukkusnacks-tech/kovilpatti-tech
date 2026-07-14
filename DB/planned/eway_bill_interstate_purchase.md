# E-Way Bill — Interstate Purchases (Karnataka / Andhra Pradesh → Tamil Nadu)

> Explains the certificate/document needed when this business buys goods from
> a supplier in another state (e.g. Karnataka, Andhra Pradesh) and transports
> them into Tamil Nadu. This is a GST/logistics compliance requirement, not a
> software feature — captured here for reference alongside the POS/Accounts
> work since goods movement ties into Purchases → Accounts.

## What it is

**E-Way Bill (Electronic Way Bill)** — a mandatory electronic document under
GST law that must accompany any consignment of goods worth above a threshold
value while it is being transported, **especially for interstate movement**
(state-to-state, e.g. Karnataka → Tamil Nadu). It proves the goods being
transported are backed by a genuine invoice/purchase and that GST has been
accounted for. Without it, the vehicle/goods can be detained and penalized at
a check-post or during an inspection.

It is **not the same as a GST invoice** — the invoice is the bill for the
goods; the e-way bill is a *transport permit* generated on top of that
invoice, tied to the vehicle carrying the goods.

## When it's needed (for this business)

- **Interstate purchase** (Karnataka/Andhra Pradesh supplier → Tamil Nadu shop
  or godown): required whenever the **consignment value exceeds ₹1,00,000**
  (this is the current threshold effective 2026; it was ₹50,000 earlier —
  always double-check the live threshold on the portal since it's revised
  periodically).
- Applies regardless of who is transporting — supplier's own vehicle, a
  hired transporter, or the shop's own vehicle picking up stock.
- **Not needed** for movement fully within Tamil Nadu below the intrastate
  threshold (varies by state, generally ₹50,000–₹2,00,000) — but check Tamil
  Nadu's specific intrastate limit separately; interstate is the stricter case
  relevant to this question.

## Who generates it & how

Either the **supplier** (in Karnataka/AP) or the **buyer** (this business, if
registered under GST) can generate it — commonly the supplier does it since
they raise the invoice first, but the buyer should always confirm one exists
before the goods leave, since liability for a missing e-way bill can fall on
whoever is caught transporting.

### Step-by-step generation

1. Go to **ewaybillgst.gov.in** (or `ewaybill2.gst.gov.in`, the newer portal).
2. Log in with the business's **GSTIN** and credentials (2-factor
   authentication is now mandatory).
3. Select **"Generate New"** under the E-Waybill menu.
4. **Fill Part A** (invoice/consignment details):
   - GSTIN of supplier and recipient (this shop's GSTIN as recipient)
   - Place of delivery (PIN code — the Tamil Nadu shop/godown address)
   - Invoice/Bill/Challan number and date
   - Value of goods
   - HSN code of the goods (snacks/food items have their own HSN codes)
   - Reason for transportation (e.g. "Purchase")
5. **Fill Part B** (transport details):
   - Vehicle number (mandatory for road transport before the trip starts)
   - Transporter ID, if a third-party transporter is used
6. Submit → system generates a unique **12-digit E-Way Bill Number (EBN)**.
7. **Print or save digitally** — the transporter must carry this (paper or
   on a phone) along with the invoice during the entire trip.

## Documents required to generate it

- Invoice / Bill of Supply / Delivery Challan from the supplier
- GSTIN of both supplier and recipient (this business's GSTIN)
- Vehicle number (for road transport)
- Transporter ID, if using a hired transporter

## Validity & other rules to know

- **Validity period:** roughly 1 day per 200 km of transport distance (so a
  Bangalore → Kovilpatti trip of ~600 km would need ~3 days' validity).
- Can be **extended** if the trip is delayed, up to a maximum window from
  original generation.
- Invoice must be dated within the recent window (currently 180 days) of
  e-way bill generation — can't retroactively cover an old invoice.
- **Voluntary closure** is now possible once delivery is confirmed complete.
- **Penalty for missing/invalid e-way bill:** ₹10,000 or the tax amount
  sought to be evaded, whichever is higher — plus the vehicle/goods can be
  detained until resolved. This is a real operational risk if a shop sends
  its own vehicle to fetch interstate stock without confirming one exists.

## Practical takeaway for this business

- Before any Karnataka/AP purchase over ₹1,00,000 is transported, **confirm
  with the supplier that an e-way bill has been generated**, and get a copy
  of the EBN + document to keep with the purchase record.
- If the shop's own vehicle/staff picks up goods, **the shop itself may need
  to generate Part B** (vehicle details) even if the supplier did Part A —
  this responsibility should be clarified with the supplier per trip.
- Threshold and exact rules are revised periodically by the GST Council —
  verify current limits on ewaybillgst.gov.in before relying on the ₹1,00,000
  figure above for an actual purchase decision.
- Consult the business's GST/tax consultant for anything beyond this
  general explanation, especially disputed cases or exempted goods.

## Where this fits in the Kovilpatti codebase today

**Important gap check:** the codebase currently has **no vendor/supplier
purchase module at all.** Confirmed by searching the schema —
`products.purchase_price` (`DB/phase1/phase1_init.sql:212`) is just a cost
figure used by Accounts to compute profit (`Sales − qty × purchase_price`);
it is not tied to any actual purchase transaction, vendor, or invoice. The
only real "goods movement" tables are `stock_requests` /
`stock_request_items`, and those model **godown → shop** internal transfers,
not an external vendor bringing stock **into** the godown.

So an interstate purchase from a Karnataka/AP vendor into the godown is a
**flow the app doesn't capture yet.** To use e-way bills here, this needs a
new capability first — sketched below.

## Proposed implementation: `vendor_purchases` module (new, Phase 6-ish)

### New tables

**`vendors`**
| Column | Notes |
|---|---|
| `id`, `name`, `gstin`, `state` | supplier master — `state` used to auto-flag interstate |
| `is_active` | |

**`vendor_purchases`** (header — mirrors `stock_requests` shape)
| Column | Notes |
|---|---|
| `id`, `code` (`PUR0001`, same seq pattern) | |
| `vendor_id` → vendors | |
| `godown_id` (inventory) | destination godown |
| `is_interstate` | derived: `vendor.state <> 'Tamil Nadu'` |
| `invoice_number`, `invoice_date`, `invoice_amount` | supplier's bill |
| `eway_bill_number` | **the 12-digit EBN**, nullable |
| `eway_bill_valid_upto` | date, nullable |
| `eway_bill_doc_url` | uploaded copy of the e-way bill (Cosmos/blob-stored file, same pattern as any document upload already in the app) |
| `status` | Ordered → Received (mirrors request lifecycle) |
| `total_qty`, `total_amount` | cached aggregates, same pattern as `stock_requests.total_items/total_qty/total_amount` |

**`vendor_purchase_items`** — `product_id`, `qty`, `unit_cost` (snapshot,
same rationale as `stock_request_items.unit_price`).

### Validation rule (the actual "certificate usage" point)

This is where the e-way bill genuinely gets **used**, not just stored:

- On `vendor_purchases` create/update, a business-rule check:
  `IF is_interstate AND invoice_amount > eway_bill_threshold AND
  eway_bill_number IS NULL/blank → block "Received" status transition`,
  with a warning banner: *"Interstate purchase over ₹1,00,000 needs an
  e-way bill number before it can be marked Received."*
- `eway_bill_threshold` should be an `app_settings` row (same
  master-switch pattern as `request_lock_enabled` / `pos_allow_oversell`
  proposed earlier) — because GST Council revises this figure periodically
  and it must be editable without a code change.
- This mirrors how the codebase already gates `stock_requests` status
  transitions with business rules in the SP layer — same shape, new table.

### Screens needed (FE)

1. **`AdminVendors.tsx`** — vendor master CRUD (name, GSTIN, state) — same
   list/dialog shape as `Shops.tsx`.
2. **`AdminVendorPurchases.tsx`** — purchase list (filter by vendor, godown,
   interstate flag, status).
3. **`AdminVendorPurchaseNew.tsx` / detail** — create/edit a purchase:
   - Vendor + godown pickers, invoice number/date/amount
   - **If `is_interstate` is true**, an "E-Way Bill" section appears:
     EBN input, validity date, and a file-upload for the EBN copy/PDF
   - "Mark Received" button — disabled with a tooltip if the validation
     rule above is unmet
4. Line items grid — product, qty, unit cost (same UX as
   `ShopRequestNew.tsx`'s item picker).

### How it flows into Accounts / Dashboard (already-built screens)

- `vendor_purchases.invoice_amount` (Received only) becomes the real
  **Purchases (MTD)** figure in Accounts/Dashboard — replacing today's
  approximation of `qty dispatched × products.purchase_price`, which is a
  proxy, not an actual purchase record.
- The e-way bill number/date itself doesn't appear in Accounts — it's a
  **compliance attachment on the purchase record**, kept for audit/GST
  filing reference (e.g. if a GST officer or auditor asks to see proof of
  transport for an interstate purchase).

### Why this matters even without full build-out now

Even before the full vendor-purchase module is built, the codebase already
has the exact pieces this pattern would reuse: sequence-generated codes
(`seq_request_code` style), snapshot-pricing, cached aggregates kept in
sync by SPs, and an `app_settings` master-switch mechanism. So this is a
"Phase 6"-shaped addition, not a foreign concept to the codebase — same
approach as the POS Billing "Phase 5" plan.

## Sources

- ewaybillgst.gov.in (official E-Way Bill portal)
- cbic-gst.gov.in (official CBIC GST portal)
