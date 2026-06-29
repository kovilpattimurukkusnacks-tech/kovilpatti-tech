# Special / Back-order Stock Requests

> **Status:** Planned — not built. Parked at client's request on 29-Jun-2026.
> Re-open when the client wants to schedule the build (estimated ~2½ days end-to-end).

## Problem

Some categories (Pickle / Thokku / Podi, occasional bulk SKUs) aren't held in
godown stock. The godown procures from a vendor and the goods take **2–4 days**
to arrive. Today the shop can't move forward during that gap because the
active-request rule blocks the next request. We need a way for slow-moving
items to wait without stalling the shop's day-to-day order flow.

## Approach: split-request with parent linkage

When the godown approves a request, items flagged for vendor procurement get
**split off into a separate "Back-order" request** that's linked to the
original. The original closes normally once the in-stock items dispatch. The
back-order sits in its own queue and **does not count against the shop's
active-request limit**.

### Why this over a per-line `on_order` flag?

The per-line flag is half the schema work but turns one request into a
multi-status thing, which complicates dispatch / totals / print everywhere
it's read. The split-request model keeps every state machine
(`Pending → Approved → Dispatched → Received`) intact and unchanged — the
back-order just rides the same rails as a normal Order, with a different
`request_type` tag and a `parent_request_id` linking it back.

## Data model changes

| Change | Detail |
|---|---|
| `stock_requests.parent_request_id` | nullable FK → `stock_requests.id`. Points back to the original request a back-order was carved from. |
| `request_type` enum | extend existing `'Order' \| 'Return'` → add `'Backorder'`. |
| `products.is_vendor_procured` | boolean, default `false`. Flags slow-moving SKUs as candidates for back-order at approval time. |
| `stock_request_items.expected_arrival_at` | nullable timestamp. Godown's ETA estimate, surfaced to shop on the request detail. **Optional**. |

## State machine

Back-order request follows the **same lifecycle** as a normal Order:
`Pending → Approved → Dispatched → Received`

Created automatically at status `Approved` at the moment the parent is
approved — it skips Pending, because the shop has already committed to
wanting those items.

## Workflow

1. Shop submits request **R1** (mix of in-stock + vendor-procured items).
2. Godown opens R1 for approval. Items where `is_vendor_procured = true` are
   pre-checked; godown can toggle others if it knows current stock is short.
3. On approve, backend:
   - keeps in-stock lines on R1 (status → `Approved`),
   - moves vendor-procured lines into a new request **R1-B** with
     `parent_request_id = R1.id`,
     `request_type = 'Backorder'`,
     status `Approved`.
4. Godown dispatches R1 normally. Shop receives. R1 closes.
5. **Active-request check ignores `request_type = 'Backorder'`** — shop can
   submit R2, R3, … while R1-B is still pending vendor delivery.
6. When vendor delivers, godown dispatches R1-B. Shop receives. R1-B closes.

## UI touch-points

- **Products screen** — "Vendor procurement" toggle on the edit dialog
  (sets `is_vendor_procured`).
- **Inventory approve dialog** — two sections:
  *"Dispatch now"* (in-stock) and *"Back-order"* (vendor). Per-line checkbox
  lets godown move items between sections. Optional ETA input.
- **Shop request detail** — when a request has a back-order child, show a
  banner: *"X items are on back-order, ETA ~Y days. Tracking as REQ####-B."*
  with a link to the child.
- **Shop requests list** — back-order rows show a "Back-order" chip next to
  the code (similar styling to the existing "Return" chip).
- **Inventory queue** — new **"Procurement"** preset chip that filters
  `request_type = 'Backorder' AND status IN (Approved, Dispatched)` so the
  godown can see what's outstanding from vendors at a glance.
- **Active-request guard** — the SP/service that enforces "one active
  draft + Pending per shop" excludes `request_type = 'Backorder'` rows.

## Accounts / reporting

- By-shop, by-category, top-products: roll **parent + back-order amounts
  together** when reporting shop-level totals — otherwise the shop's monthly
  purchase looks artificially split.
- Adjustments log: back-order receipts logged the same way as parent
  receipts; no special handling.
- Print picklist for godown: optional "Vendor source" column on the
  back-order picklist so the procurement person knows which vendor to chase
  per line.

## Open decisions (need client input before building)

1. **Who flags slow-moving SKUs** — admin once at product setup, or godown
   ad-hoc per request?
   *Proposed:* admin sets `is_vendor_procured` as default, godown can
   override per request.
2. **Does the shop see the split happening** — notification at the moment
   R1 is approved and R1-B is created, or only visible when they open the
   detail?
   *Proposed:* visible on detail + a small badge on the list row.
3. **Cancellation rules for back-orders** — if vendor procurement falls
   through, can godown cancel R1-B independently of R1?
   *Proposed:* yes, with a reason field.
4. **ETA field** — required or optional?
   *Proposed:* optional, so godown isn't blocked when they don't know yet.

## Build estimate (rough)

| Layer | Effort |
|---|---|
| DB migration (3–4 columns, enum extension) | 1 hour |
| Backend (split logic in `fn_stock_request_approve`, active-request guard, back-order list endpoint) | half-day |
| Frontend (approve dialog redesign, back-order chip, procurement tab, child-link banner) | 1 day |
| Accounts roll-up (touch the three SPs added in Phase 3) | half-day |
| **Total** | **~2½ days** of build + test |
