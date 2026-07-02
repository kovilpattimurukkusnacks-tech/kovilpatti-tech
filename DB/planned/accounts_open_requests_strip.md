# Accounts — Open Requests strip

> **Status:** Planned — not built. Parked at client's request on 01-Jul-2026.
> Build cost ~1 hour (small SP + FE strip). No risk to existing accounts numbers.

## Problem

The Accounts page only shows values from **finalised** orders — Orders in
`status = 'Received'` and Returns in `status = 'Accepted'`. The
"Requested" tab therefore reads ₹0.00 for any day where nothing has been
*received* yet, even when shops have submitted plenty.

Admin wants to see **what's been requested but not yet received / dispatched**,
without breaking the closed-ledger semantics of the existing KPIs.

## Design decision — why not just re-anchor Requested on `submitted_at`

Rejected because it destabilises the books:

- A shop submits ₹5,000 today → Requested shows ₹5,000.
- Shop cancels tomorrow OR godown dispatches short by ₹2,000.
- Historical Requested figure for "today" would silently mutate over
  time whenever the source request's status changes.
- Any GST / tax / reconciliation admin does off these numbers breaks.

The finalised-only design (received_at anchor) is deliberate — the KPI
cards are a **stable ledger**. The pipeline view needs its own container.

## The plan

Add a **second strip** on top of the Accounts page, sibling to the
existing **In Transit** strip:

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🕐 OPEN REQUESTS   ₹42,300.00   3 submitted, not yet dispatched      │
│                                 · oldest 4 hours ago                 │
└─────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────┐
│ 🚚 IN TRANSIT      ₹3,84,893.00 9 dispatched, not yet received       │
│                                 · oldest 1 day ago                   │
└─────────────────────────────────────────────────────────────────────┘
```

Both strips are pipeline snapshots — they're "as of now" views, not
tied to the date range filter. The KPI cards + by-shop / by-category
tables below continue to reflect the **closed books** for the selected
range.

## DB changes

### New SP: `fn_accounts_open_requests`

```sql
CREATE OR REPLACE FUNCTION fn_accounts_open_requests(
  p_shop_ids   uuid[] DEFAULT NULL,
  p_inv_ids    uuid[] DEFAULT NULL,
  p_cat_ids    int[]  DEFAULT NULL
)
RETURNS TABLE (
  open_amount        numeric,
  open_request_count bigint,
  oldest_submitted_at timestamptz
)
LANGUAGE sql STABLE AS $$
  WITH filtered AS (
    SELECT r.id, r.total_amount, r.submitted_at
    FROM   stock_requests r
    WHERE  r.is_deleted = false
      AND  r.status IN ('Pending', 'Approved')       -- submitted, not yet dispatched
      AND  r.request_type = 'Order'                  -- Orders only
      AND  (p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0 OR r.shop_id      = ANY(p_shop_ids))
      AND  (p_inv_ids  IS NULL OR cardinality(p_inv_ids)  = 0 OR r.inventory_id = ANY(p_inv_ids))
      -- Category filter via item->product join (same pattern as
      -- fn_accounts_summary). Omitted here for brevity — copy the
      -- cat_closure CTE + EXISTS(items) guard from that SP.
  )
  SELECT
    COALESCE(SUM(total_amount), 0)::numeric(14,2)  AS open_amount,
    COUNT(*)::bigint                                AS open_request_count,
    MIN(submitted_at)                               AS oldest_submitted_at
  FROM filtered;
$$;
```

Notes:
- **No date range param** — the strip shows the LIVE pipeline. Filters
  by shop / inventory / category still apply (respect the page-level
  filter bar).
- Same category-closure pattern as `fn_accounts_summary` (recursive
  descend into sub-cats).
- Rejected / Cancelled orders are excluded — they're not "open".

## BE changes

- New DTO: `AccountsOpenRequests` in `Business/DTOs/Accounts/` —
  `{ openAmount, openRequestCount, oldestSubmittedAt }`.
- New endpoint: `GET /api/accounts/open-requests` — accepts the same
  `shopIds`, `inventoryIds`, `catIds` query params as the other
  accounts endpoints.
- Service + repo methods calling the new SP.

## FE changes

- New React Query hook: `useAccountsOpenRequests(filters)` — same
  filter shape as the existing accounts queries.
- New component: `OpenRequestsStrip` — mirror of the existing
  `InTransitStrip` styling; renders only when `open_request_count > 0`.
- `AdminAccounts.tsx` — render `<OpenRequestsStrip>` **above** the
  existing `<InTransitStrip>` (chronological order: not-yet-dispatched
  → dispatched-not-received).

## Interaction with tabs / view mode

- Present on ALL view tabs (All Activity / Requested / Dispatched /
  Returns) — pipeline is always relevant.
- Filter bar changes (shop / inventory / category) refetch the strip
  same as the other accounts queries.

## Build estimate

| Layer | Effort |
|---|---|
| DB SP + one-shot upgrade script | 20 min |
| BE DTO + endpoint + service + repo | 20 min |
| FE hook + strip component + AccountsAdmin wiring | 20 min |
| **Total** | **~1 hour** |

## What this does NOT change

- Existing `fn_accounts_summary` / `fn_accounts_by_shop` /
  `fn_accounts_by_category` / `fn_accounts_top_products` /
  `fn_accounts_adjustments` — all untouched. Closed-book semantics
  preserved.
- KPI cards + by-shop / by-category tables still report only
  `Received`-anchored numbers over the selected date range.

## Open decisions

1. **Should returns be counted in Open Requests?** Returns follow
   Pending → Accepted with no Dispatch step; a Pending Return is a
   different kind of "open". *Proposed:* skip Returns here — they'd
   need a separate strip if surfaced.
2. **Threshold before "oldest" text goes red?** In-transit turns red
   at "oldest 1 day ago". *Proposed:* Open Requests strip goes red at
   "oldest 4 hours ago" (same-day expectation for a fresh order).
3. **Click-through**: does clicking the strip filter the tables to
   open orders? *Proposed:* no — the tables are a ledger, not a
   pipeline. Keep concerns separated.

## Trigger for building

Client says the current "Requested KPI showing zero" is confusing when
shops have obviously submitted orders today. Once they've seen the
Open Requests strip in DEV, if they want tables also to reflect
pipeline, we can revisit.
