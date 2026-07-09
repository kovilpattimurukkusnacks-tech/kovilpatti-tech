# Admin — "New Stock Request" screen (planned)

> **Status:** Planned. Not built.
> Discussed 08-Jul-2026 alongside Phase 4 (billing + shop inventory).

## Why

Two use cases converge on the same feature:

1. **Phase 4 opening stock** — admin sets nightly lump-sum stock per shop.
   Reusing the existing stock-request flow (dispatched-same-day) is cheaper
   than a separate `shop_stock_opening` table.
2. **Direct admin orders** — admin raises a request on a shop's behalf
   (event bulk order, manual entry when shop can't submit, etc.).

Both need the same capability: admin picks a shop, builds a cart, submits.

## Scope

### BE

- `CreateStockRequestRequest` gains an optional `ShopId?` field.
- `StockRequestService.CreateAsync`:
  - Role = ShopUser  → force `currentUser.ShopId`, reject any supplied `ShopId`.
  - Role = Admin     → REQUIRE `ShopId` in the payload, use it verbatim.
- `fn_request_create` — no change; `p_shop_id` already parameterised.

### FE

- New route `/admin/requests/new` in `App.tsx`.
- "New Request" button on `AdminRequests.tsx` header.
- `ShopRequestNew.tsx` grows an admin-create branch alongside the
  existing `isEditMode` and shop-user branches:
  - Shop-picker Autocomplete at the top (visible ONLY for admin-create).
  - Same cart / categories / review-dialog flow as the shop user.
  - Submit forwards the picked shopId.
- Success → land on `/admin/requests/{new-id}` with a toast.

## Behaviour differences from the shop-user flow

**No visit-category gate for admin** (08-Jul-2026 client req). The
"you must browse every category before Submit" gate on the shop side
protects shop users from missing a routine SKU set. Admin flows are
one-off, deliberate, and often for a single category — the gate would
just be friction. Skip it entirely when the caller is admin:

- `reviewGate` computation in `ShopRequestNew.tsx` should short-circuit
  to `false` when `isAdmin === true` (regardless of `visitedCategoryIds`).
- The "N/11 categories done" counter should also hide for admin — no
  progress-tracking UI when there's no gate to gate.
- The "jump to first unvisited on resume" effect stays off for admin
  (the ref-based guard already handles this via `hydratedFromSourceRef`).

## Estimate

~1–1.5 days end-to-end (BE + FE + testing across roles).

## Open questions to resolve before build

1. **Notes / Special Request toggle on admin path** — admin should be
   able to set both (mirrors what the shop can do). Confirm.
2. **Cart-size ceiling** — same limit as shop, or unlimited for admin
   bulk orders (e.g., opening-stock could easily hit 100+ SKUs)?
3. **Auto-approve** — admin's own requests still start Pending, or
   auto-flip to Approved? Draft-versus-final semantics.
4. **Auto-dispatch (Phase 4 opening-stock case)** — for the "nightly
   opening" use case, is a single click enough to submit + approve +
   dispatch + receive in one shot, or do we want an explicit
   "opening stock" button that runs that sequence?
