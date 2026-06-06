## Context

Phase 2 finalized request lifecycles (`Received` for Orders, `Accepted` for Returns) and added the `stock_request_qty_audits` table for post-completion admin edits, explicitly framed in `phase2_init.sql` as the data substrate for "Phase 3 accounts". That Phase 3 work has been pending: CLAUDE.md lists it as "planned (uses the qty-edit audit trail). Not built."

The current product surfaces all of this data **per request** — admins must open individual requests to see what shipped, what came back, and what got edited. There is no aggregate, date-ranged view. SK's owner-operators need to answer week-by-week questions ("what did we move?", "which shop was active?", "what did we adjust?") to drive their books, and today they reconstruct that from request lists by hand.

This change adds the first slice: a read-only dashboard over data that already exists, plus CSV exports of every section. No new tables, no schema migrations, no posting to external accounting tools — those decisions are bigger and would benefit from feedback on the v1 surface first.

**Anchors confirmed in explore session (2026-06-01):**

- `unit_price` on `stock_request_items` **is the retail MRP** snapshot at submit time. All ₹ figures on the page must be labelled "MRP value" to prevent confusion with revenue or margin (which this report does not compute — shop and godown are the same business).
- v1 is **reporting-only with CSV export**. No external accounting integration, no period locking, no manual journal entries.

## Goals / Non-Goals

**Goals:**

- Single admin-only dashboard at `/admin/accounts` answering "what moved in this date range".
- KPI strip: Dispatched, Returns, Net, Adjustments (4 cards).
- Breakdown tables: by shop, by category (nested-aware), top N products.
- Adjustments log surfacing `stock_request_qty_audits` rows, cash-basis (posted on `edited_at`).
- In-transit strip showing dispatched-but-not-received Orders, independent of date range.
- CSV export per table, server-side.
- Filters (date range, shop, category) preserved in URL query params; the range defaults to the current IST month.

> **Post-build simplification (non-technical audience):** the trend chart and the day/week/month grouping control were dropped from the dashboard, and the Godowns/inventory filter was removed. The backend trend SP/endpoint and the `inv_ids` / `grouping` params still exist but are no longer surfaced. Decisions 4 and 7 below are retained for history; see the deviations noted inline.

**Non-Goals:**

- Posting to external accounting systems (Tally, Zoho, etc.).
- Period locking — past period totals can shift if admins re-finalise or if data is back-loaded, by design.
- Manual journal entries / non-stock adjustments.
- Payment, settlement, or receivables tracking.
- GST or tax band breakdown.
- Multi-currency anything.
- P&L reporting — since the same business owns both godown and shop, there is no margin to compute.
- Inventory-user role for v1 (admin only). Inventory-user view of "their own godown" is a follow-on.

## Decisions

### Decision 1: Anchor date is `received_at` (Orders) / `accepted_at` (Returns)

Each report row is anchored to the timestamp at which the movement was **confirmed by both sides** — the shop's receipt for Orders, the godown's acceptance for Returns. This is the closest analogue to a books date in the existing schema.

**Alternatives considered:**

- *`dispatched_at` for Orders.* Counts goods on the day they leave the godown, before shop confirmation. Inflates a period if shops sit on un-acknowledged deliveries; mismatches with the per-shop view of "what we got". Rejected.
- *`submitted_at`.* The day the shop placed the request. This is a *demand* date, not a *fulfilment* date — unsuitable for accounts.

**Consequences:**

- Only `Received` and `Accepted` requests contribute to KPI / breakdown / trend numbers. `Draft / Pending / Approved / Dispatched / Cancelled / Rejected` are excluded from the main flow but the dispatched-but-not-received subset becomes the dedicated In-transit strip.
- A request finalised at 23:55 IST on 31-May is counted in May. A request finalised at 00:05 IST on 1-Jun is counted in June. Both timestamps are stored UTC; the SP must `AT TIME ZONE 'Asia/Kolkata'` before truncating.

### Decision 2: Adjustments are cash-basis on `edited_at`

When an admin edits a finalised request's `dispatched_qty` (via `fn_request_item_edit_dispatched_qty`), the resulting `stock_request_qty_audits` row gets a fresh `edited_at`. The Accounts page **counts that delta in the period that contains `edited_at`**, not the period of the original request's `received_at` / `accepted_at`.

**Why:**

- Reports for past periods stay stable once viewed. An audit row posted today does not silently change last week's numbers.
- The audit table is append-only and already carries a denormalized `request_id`, `old_qty`, `new_qty` — cash-basis is what the data shape already supports without further joins or recomputation.
- It matches how a paper book is kept: corrections are entered on the date they're made, with a reference to the original transaction.

**Alternatives considered:**

- *Retroactive (backdate to parent's date).* More technically accurate but means any historical period total can mutate. Requires the SP to either recompute all aggregates on every read (cost) or maintain a derived snapshot (complexity). Rejected for v1.
- *User-toggleable view.* Doubles SP surface and risks confusing users with two numbers for "the same" period. Rejected — can be added later if owner asks.

**Consequences:**

- The Adjustments card and Adjustments log are *separate* from the Dispatched / Returns KPIs. Net is not affected by adjustments; it is computed from the request totals as of finalisation.
- The Adjustments delta value uses the line's `unit_price` snapshot (not current MRP) so historical economics stay stable even if the product's MRP changes later.

### Decision 3: All reporting SPs live in `DB/phase3/`

CLAUDE.md mandates the `phase{N}_init.sql` / `phase{N}_procedures.sql` naming convention with one-shot scripts gitignored under `DB/One shot scripts/`. The Phase 3 folder doesn't exist yet — this change creates it. `phase3_init.sql` is a no-op placeholder (no new tables in v1) included for consistency and future-proofing; `phase3_procedures.sql` holds the seven new reporting SPs.

**Why not bundle into `phase2_procedures.sql`?** Phase 2 is conceptually "the request workflow". The reporting layer is downstream and will grow (more SPs, possibly new tables for cached aggregates or period locks). Keeping it in its own phase folder makes the boundary explicit and matches the established repo convention.

### Decision 4: Charting library is `@mui/x-charts` — SUPERSEDED (chart removed)

> **Superseded post-build:** the trend chart was removed from the dashboard during UI-review simplification for the non-technical audience, so `@mui/x-charts` is no longer rendered (the dependency remains installed but unused, and `TrendChart.tsx` is an orphan). The rationale below is kept for history.

The frontend is already committed to MUI v9 + MUI X DataGrid. `@mui/x-charts` is from the same family — same versioning, same theming hooks, same styling story (works with the gold-gradient theme without custom CSS). Lower-friction than introducing a second charting library (recharts, nivo).

**Trade-off:** `@mui/x-charts` is younger than recharts and its DX is less ergonomic for highly-customized charts. For v1 we only need a stacked bar + a line overlay — well within its capabilities. If charting needs grow (treemaps, gauges, sparklines in tables) we can revisit.

### Decision 5: CSV export is server-side, one endpoint per table

Each breakdown table gets its own export endpoint (`GET /api/accounts/export/by-shop?from=…&to=…`). The endpoint runs the same SP as the on-screen table and streams a CSV response with `Content-Type: text/csv; charset=utf-8` and a `Content-Disposition: attachment; filename=…` header.

**Why not client-side?**

- The displayed tables are paginated / sorted client-side; exporting from client state risks shipping the wrong rows.
- A growing dataset (months of data on a busy godown) eventually exceeds a comfortable client payload. Streaming from the server stays flat.
- Format consistency: server controls escaping, date formatting (ISO 8601 in UTC + display string in IST), numeric precision.

**Trade-off:** one extra controller method per table. Cheap.

### Decision 6: Category filter expands to all descendants

Categories are nested (`fn_category_tree` returns a recursive root-first list). The Category multi-select filter accepts category ids; the SP expands each selected id into "self + all descendants" before filtering products. Selecting "Biscuits" should pull every "Big Biscuit", "Small Biscuit", … row up.

**Implementation:** SP takes `p_category_ids uuid[]`; internally a recursive CTE walks the `parent_id` chain to gather the closure. No FE change beyond a multi-select picker.

### Decision 7: Filter & range URL semantics

All filters are query params on `/admin/accounts`:

```
?from=2026-06-01&to=2026-06-04
&shopIds=<uuid>,<uuid>
&categoryIds=<int>,<int>
```

Dates are calendar dates in IST (no time component). The BE converts them to `[from 00:00 IST, to+1 00:00 IST)` half-open ranges in UTC for the SP query. **Default range on first load: the current IST month** (1st-of-month through today, IST). (Originally "this week"; changed during the simplification.)

Stale or unknown `shopIds` / `categoryIds` (e.g. after a re-seed or an old shared link) are dropped once the shop/category lists load — treated as no filter and stripped from the URL — so a broken link self-heals instead of silently zeroing the page. The `grouping` and `inv_ids` params were removed from the UI (see the post-build note above).

**Why URL state and not just component state?** Same reason `AdminRequests` does it: a date-pinned link is shareable, and a refresh shouldn't lose the filter.

### Decision 8: Read-replica safety (not enforced)

All Accounts SPs are pure SELECTs over indexed columns with date-range filters. They are safe to run against a read replica if one is later added. Nothing in this change writes to existing tables. Documenting this explicitly because Phase 3 has historically been spoken of as "books integration" — future work that *does* write (e.g. posting journal entries) must opt out of read-replica routing.

## Risks / Trade-offs

- **[Cash-basis surprise]** → Owner sees an adjustment posted "today" that actually corrects a 3-week-old request and is briefly confused that "last week's numbers didn't move". *Mitigation:* every row in the Adjustments log shows both the audit `edited_at` and the original request code (which has its own `received_at`) so the relationship is one click away.
- **[Stacking-bar legibility]** → Returns are typically 5–10% of Dispatched value; on a stacked-bar chart over a small range, Returns can become a one-pixel sliver. *Mitigation:* default chart is grouped (side-by-side) bars, not stacked; switch to stacked is a chart-level toggle (deferred to v2 if asked).
- **[CSV character encoding]** → Tamil shop names in CSV opened in legacy Excel render as mojibake unless BOM-prefixed. *Mitigation:* emit UTF-8 BOM (`\xEF\xBB\xBF`) at the start of the byte stream. (Standard for Excel-bound CSVs in India.)
- **[Timezone bugs]** → Off-by-one-day errors are the most common bug pattern when reports span IST/UTC. *Mitigation:* the SP layer is the single place that converts; the BE passes calendar-date params; the FE never touches UTC. Unit-test the SP on edge cases (23:55 IST on last day of range, 00:05 IST on first day of next range).
- **[Big-range performance]** → A "Last 90 days" range over a populated DB scans thousands of rows. *Mitigation:* the existing `idx_stock_requests_status_submitted` index covers `(status, submitted_at)` but not `received_at`. v1 ships without a new index and we measure; if needed we add `idx_stock_requests_status_received` (partial, where `is_deleted=false AND status='Received'`) and `idx_stock_requests_status_accepted` likewise in a Phase 3 addendum. Logging the query plan during dev seeding is part of tasks.
- **[Charting library bet]** → `@mui/x-charts` is younger than recharts. *Mitigation:* trend chart is encapsulated in a single component (`<TrendChart>`); swap is bounded to one file.
- **[No period locking]** → An admin editing a stale qty months later still posts cleanly. Books and dashboard can drift if the admin's edit reasons aren't audited downstream. *Mitigation:* explicitly out of scope; Adjustments log captures every edit with `reason` and `edited_by` so the audit trail is always reconstructable.

## Migration Plan

This is a purely additive change. No schema changes to existing tables.

**Forward:**

1. Apply `DB/phase3/phase3_init.sql` (idempotent — only the file scaffolding for future Phase 3 work; no DDL in v1).
2. Apply `DB/phase3/phase3_procedures.sql` (uses `CREATE OR REPLACE`; re-runnable).
3. Deploy backend with new `AccountsController` + service + repo.
4. Deploy frontend with new page + sidebar entry + `@mui/x-charts` dependency.

**Rollback:**

1. Revert frontend deploy — sidebar entry vanishes, no other user surface affected.
2. Revert backend deploy — `AccountsController` routes go 404 but nothing else breaks (no shared code paths).
3. `DROP FUNCTION fn_accounts_*;` is safe (only called from the new endpoints).
4. `phase3_init.sql` is a no-op; nothing to undo.

No data migration. No user retraining. Admins discover the new sidebar entry; everyone else sees no change.

## Open Questions

- Should the In-transit strip show **just the count** or the full **₹ value** of in-transit goods? Strip currently designed to show ₹ value + count — confirm during UI review.
- ~~Default range on first load: **this week (Mon–today, IST)**~~ — **Resolved:** default is **this month** (1st-of-IST-month through today), per owner request.
- CSV filename convention: proposed `accounts-by-shop_2026-05-25_to_2026-05-31.csv`. Confirm during UI review.
