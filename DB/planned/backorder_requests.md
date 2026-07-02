# Special / Back-order Stock Requests

> **Status:** Planned — not built. Refined 01-Jul-2026.
> Re-open when the client wants to schedule the build (estimated ~3–3½ days end-to-end).

## Problem

Some categories (Pickle / Thokku / Podi, occasional bulk SKUs) aren't
held in godown stock. The godown procures from a vendor and the goods
take **2–4 days** to arrive. Today the shop can't move forward during
that gap because the active-request rule blocks the next request. We
need a way for slow-moving items to wait without stalling the shop's
day-to-day order flow — AND all three roles (shop / inventory / admin)
need to see that a back-order is outstanding, not hidden away.

## Approach: split-request with parent linkage

When the godown is about to dispatch a request, any items they can't
fulfil right now get **moved into a sibling "Back-order" request** —
linked via `parent_request_id`. The original request dispatches with
just the in-stock items and closes normally. The back-order sits in
its own queue and **does not count against the shop's active-request
limit**, so the shop keeps operating.

Once the vendor delivers (2–4 days later), the godown dispatches the
back-order like any other order. Shop confirms receipt. Back-order
closes.

### Concrete example

- Shop places **R1** with 10 items on 29-Jan.
- Godown opens R1 — 3 items are out of stock (pickle, thokku, podi).
- Godown clicks **"Move to back-order"** on those 3 lines. Backend
  transfers them to a new **R1-B** (`request_type = 'Backorder'`,
  `parent_request_id = R1.id`, status `Pending`).
- Godown dispatches R1 with the remaining 7 items. Shop receives.
  R1 closes.
- Meanwhile R1-B sits in the "Procurement" queue on the inventory
  side and shows as a **pinned banner** on the shop's list.
- On 3-Feb the vendor delivers. Godown dispatches R1-B. Shop
  receives. R1-B closes.

### Why split, not a per-line "on_order" flag?

Per-line flag is half the schema work but turns one request into a
multi-status thing — dispatch qtys, print totals, accounts rollup
all become conditional on whether a line is "delivered now" or
"delivered later". The split-request model keeps every state machine
untouched — the back-order rides the same `Pending → Dispatched →
Received` rails as a normal Order, with a different `request_type`
tag + a `parent_request_id` for the link.

## Data model changes

| Change | Detail |
|---|---|
| `stock_requests.parent_request_id` | nullable FK → `stock_requests.id`. Points back to the original request a back-order was carved from. NULL on normal Orders and Returns. |
| `request_type` enum | extend existing `'Order' \| 'Return'` → add `'Backorder'`. |
| `products.is_vendor_procured` | boolean, default `false`. Flags slow-moving SKUs so the inventory dispatch dialog can pre-check them for back-order. |
| `stock_request_items.expected_arrival_at` | nullable timestamp. Godown's optional ETA estimate, surfaced on the back-order detail. |

## Trigger point (under the current simplified workflow)

Original plan assumed `Pending → Approved → Dispatched` — but we've
since collapsed that: godown dispatches directly from Pending. So
there's no Approve moment to hook into.

**Decision: split happens via a new "Move to back-order" action on
the inventory detail page.** Each line item shows a "Move to
back-order" icon (godown-side only, hidden from shop/admin). Click
→ line is transferred to a new sibling R1-B. Godown then dispatches
R1 with the remaining lines as normal.

Alternative rejected: putting the split inside the dispatch dialog
itself. Clutters an already-dense screen and forces godown to decide
at the very moment they're finalising dispatch. The separate action
lets them plan ahead.

## Notifications & visibility

The client's core requirement: every role must SEE that a back-order
is outstanding — hiding it in a separate tab isn't enough. Applies
across the app AND across time (a Jan back-order arriving in Feb
must still be visible in Jan's admin accounts view).

### Shop user

- **Requests list** — sticky banner at the top: *"⏳ 2 orders on
  back-order · ETA 3-4 Feb"*. Same pattern as the "N orders awaiting
  your receipt" banner built earlier. Click → filter to Backorder.
- **List row** — the back-order request row shows a `Back-order` chip
  next to the code (like the existing `Return` chip, but amber/gold
  instead of red).
- **Detail page (original R1)** — when R1 has a back-order child,
  banner at the top: *"3 items on back-order — tracking as
  REQ1234-B, ETA 3-Feb"* with a link to the child request.
- **Detail page (back-order R1-B)** — the top status banner reads
  *"BACK-ORDER · Waiting for vendor · ETA 3-Feb"* in amber so shop
  knows this order is on a slower track.

### Inventory user

- **Incoming requests list** — new **"Procurement"** preset chip
  alongside Needs Action / In-Progress / Delivered / All / Return.
  Filters `request_type = 'Backorder' AND status IN (Pending)`. Shows
  the count as a badge on the chip.
- **Persistent banner** at the top of the incoming list (like the
  "Dispatch drafts saved" strip): *"⏳ 3 back-orders waiting on
  vendor · oldest 5 days ago"*. Never dismisses until the queue is
  empty. Clicking jumps to the Procurement preset.
- **List row** — back-order rows show the same amber `Back-order`
  chip next to the code.
- **Detail page** — `Back-order` chip in the status pill row, ETA
  visible, "Mark as dispatched" flow works normally once vendor
  delivers.

### Admin

- **Requests list** — Back-orders are naturally visible in the "All"
  preset with the amber chip; no special preset needed for admin.
- **Accounts page** — **new "Outstanding Back-orders" strip**, sibling
  to the existing In Transit strip. Sits at the top of the page:
  *"⏳ OUTSTANDING BACK-ORDERS  ₹42,300  5 back-orders pending vendor
  delivery · oldest 6 days ago"*. Critical: this strip is **pipeline-
  scoped**, not filtered by the date range. Whether admin is looking
  at January or February, they see current outstanding back-orders.
  Solves the cross-month visibility problem the client raised.
- **Accounts drilldown**: click the strip → dedicated table listing
  each outstanding back-order (parent code, back-order code, shop,
  amount, days-since-created, ETA).

### Notification mechanics (all three roles)

- **No push notifications** (no server infra for it today).
- **In-app polling** — the same React Query cache that already
  refetches lists picks up new back-orders on the next open of the
  page. The banners re-render automatically.
- **Optional Phase-2 addition**: WhatsApp / SMS on back-order create
  + on vendor-arrival — flag this as a follow-up if the client asks.

## Print integration

Back-orders must show up in every print artifact so no one working
off paper misses them.

### Per-request A4 picklist (godown)

- If R1 has a linked back-order child, add a **"Back-ordered items"
  section** at the bottom of R1's picklist listing the deferred SKUs
  + qtys + ETA. Marked with a subtle amber tint so it doesn't look
  like something the picker should pack now.
- Standalone print of R1-B (back-order picklist) header shows a
  clear **BACK-ORDER banner** at the top with the parent REQ code
  and the vendor-source column (see next section).

### Per-request thermal (shop, 3-inch)

- If R1 has back-order items, print a **"BACK-ORDERED" section**
  below the totals block with the SKU list and ETA. Shop knows what
  to expect on the follow-up delivery.
- Standalone thermal of R1-B: title flips to *"BACK-ORDER SLIP"*
  (same slot that currently flips to "RETURN BILL" for Returns).

### Cumulative batch plan (godown)

- Back-order requests included in the cumulative pending totals BUT
  visually separated: a distinct section labelled **BACK-ORDERS
  (vendor procurement)** at the bottom, after all normal roots.
- Each SKU line in that section shows the vendor source (per the
  `products.vendor_name` / notes field — client to confirm which
  master column holds this).

## Accounts / reporting

- **KPI cards** — parent + back-order amounts roll UP together in
  the shop's monthly totals. Concretely: `fn_accounts_by_shop`
  treats R1 and R1-B as one purchase event when both are Received.
  Otherwise the shop's monthly total looks artificially split (Rs
  X in Jan, Rs Y in Feb, when in truth it was one Jan order).
- **Adjustments log** — back-order receipts logged the same way as
  parent receipts; no special handling.
- **Outstanding Back-orders strip** (described above) — pipeline
  visibility, not part of the closed ledger.

## Cross-month visibility (specific client scenario)

**Scenario:** Shop places R1 on 29-Jan. Godown moves 3 items to R1-B
on 29-Jan (vendor procurement). R1 dispatches 30-Jan. R1-B dispatches
3-Feb.

**What admin sees on 30-Jan:** Accounts view filtered to January.
KPI cards show R1's 7-item value (received in Jan). Outstanding
Back-orders strip at the top shows R1-B as still-pending.

**What admin sees on 4-Feb:** Accounts view filtered to February.
KPI cards show R1-B's 3-item value (received in Feb). Outstanding
Back-orders strip now empty (nothing pending).

**What admin sees on the "All time" view:** Both R1 and R1-B rolled
together as one shop purchase event.

Cross-month visibility comes from the strip being **pipeline-scoped,
not date-scoped** — so a Jan back-order stays visible through Feb
until it dispatches, regardless of what date range the admin is
looking at.

## Open decisions (locked defaults for build)

Client can override any of these — otherwise we build to these:

1. **Who flags slow-moving SKUs** → **Admin** sets `is_vendor_procured`
   on the product master (once per SKU). **Godown can override** per
   request during the move-to-back-order action.
2. **Shop notification** → **In-app only** (banner on list + banner
   on detail). No SMS / WhatsApp for now.
3. **Cancel back-order independently** → **Yes**, godown can cancel
   R1-B with a required reason. Reason surfaces on the shop's
   detail banner (*"Cancelled: vendor unavailable"*).
4. **ETA field** → **Optional.** Godown can enter if known, skip if
   not. Print + banner just omit the ETA when NULL.
5. **Inventory Add Products (existing feature) + back-order** →
   Add Products is **in-stock only**. Back-order has its own trigger.
6. **Rollup in accounts** → **Yes, parent + back-order combined** in
   shop / category / product totals. Line-level adjustments log also
   combined.

## UI touch-points summary

| Screen | Change |
|---|---|
| Products (admin) | Add "Vendor procurement" toggle on product edit dialog |
| Inventory request detail | New per-line "Move to back-order" icon (Pending/pre-dispatch states); Back-order status banner on child requests |
| Inventory requests list | New "Procurement" preset chip; persistent back-order banner at top |
| Shop request detail | "N items on back-order" banner with link to child; back-order chip on child request itself |
| Shop requests list | Back-order chip on rows; sticky banner "N back-orders outstanding" |
| Admin accounts | New "Outstanding Back-orders" strip (pipeline-scoped) + drill-down table |
| A4 picklist print | "Back-ordered items" section at bottom of parent picklist; BACK-ORDER banner + vendor column on child print |
| Thermal print (shop) | "BACK-ORDERED" section below totals on parent; title flip on child print |
| Cumulative print (godown) | Distinct "BACK-ORDERS" section at bottom, after normal roots |

## Backend touch-points

- **New SP `fn_request_move_to_backorder(p_id, p_item_ids, p_user_id, p_eta)`** — carves given item ids off the parent into a new `Backorder` request. Recomputes both parents' totals.
- **New SP `fn_request_list_outstanding_backorders(p_inventory_id, p_shop_ids)`** — pipeline snapshot for the strip.
- **`fn_request_list_paged`** — add `request_type = 'Backorder'` filter support (already flexible via existing param).
- **Active-request guard** — the "one active shop draft + pending" rule needs to `AND request_type != 'Backorder'` so a shop with a pending back-order can still submit a new normal Order.
- **`fn_accounts_by_shop` / `fn_accounts_by_category` / `fn_accounts_top_products`** — roll `Backorder` amounts under their parent's shop / category attribution.
- **Cascade rules** — if the parent R1 is cancelled before dispatch (rare), the R1-B is also cancelled with a system-generated reason.

## Build estimate (revised)

| Layer | Effort |
|---|---|
| DB migration + new SPs (2 new + touch 4 existing) | half-day |
| BE endpoints + service + repo | half-day |
| FE: inventory move-to-back-order action + procurement preset + banners | 1 day |
| FE: shop banners + list chip + detail integration | half-day |
| FE: admin outstanding-back-orders strip + drilldown table | half-day |
| Prints (A4 + thermal + cumulative) | half-day |
| Accounts rollup (touch existing SPs) | half-day |
| **Total** | **~3–3½ days** of build + test |

Slightly larger than the original estimate — the notification/visibility
work across three roles and three prints adds most of the time.

## What this feature does NOT change

- Normal Orders (in-stock only) flow unchanged.
- Return flow unchanged.
- Existing dispatch draft / inv-add-items / draft naming / pin features unchanged.
- Existing accounts KPI cards' definitions unchanged (rollup happens on the
  same "Received / Accepted" anchor — just includes back-order children).
