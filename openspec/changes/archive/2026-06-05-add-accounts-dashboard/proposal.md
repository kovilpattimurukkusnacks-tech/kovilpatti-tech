## Why

The business has no way to see "what moved" across a date range. Phase 2 captures every lifecycle event (`received_at`, `accepted_at`, qty-edit audits) but the data is buried inside individual request detail pages — admins can't answer "how much went out last week?" without scrolling through requests one by one. This is the first step toward the Phase 3 accounts integration that CLAUDE.md flagged as planned. v1 stays deliberately read-only — no posting to external books, no period locks — so the surface is small but unlocks every downstream accounting workflow.

## What Changes

- New **Accounts dashboard** at `/admin/accounts` (admin role only) with date-range filters (defaulting to the current IST month), a KPI strip, and breakdown tables by shop, category, and top products.
- New **Adjustments log** section surfacing `stock_request_qty_audits` rows in the selected range — cash-basis: each audit posts on its own `edited_at`, period totals stay frozen.
- New **In-transit strip** showing currently-dispatched-but-not-received Orders, independent of the date range.
- New **CSV export endpoints** (server-side, one per table) so admins can download the same data they see on screen.
- New **`DB/phase3/`** directory holding `phase3_init.sql` (no new tables — placeholder for future Phase 3 work) and `phase3_procedures.sql` (the new reporting SPs).
- New **Accounts** sidebar nav entry, admin-only, between Settings and the bottom of the list.

**Scope note (post-build simplification, for the non-technical audience):** the dashboard was simplified during UI review. The **trend chart**, the **day/week/month grouping control**, and the **Godowns / inventory filter** were dropped from the dashboard, and the default range changed from "this week" to "this month". The backend `fn_accounts_trend` SP and `/api/accounts/trend` endpoint (plus the `inv_ids` / `grouping` params) still exist and work, but are no longer surfaced in the UI.

Not in scope (deferred): trend chart, posting to external accounting systems, period locking, manual journal entries, GST/tax breakdown, payment/settlement tracking, per-godown role for inventory users (admin-only for v1).

## Capabilities

### New Capabilities

- `accounts-reporting`: Read-only date-ranged reporting over the stock-request workflow — KPI aggregates, trend bucketing, breakdowns by shop/category/product, qty-edit audit log, in-transit summary, and CSV export of each table. Anchored on `received_at` (Orders) / `accepted_at` (Returns), in IST. Admin role only.

### Modified Capabilities

None — this is a new capability with no spec-level changes to existing behavior.

## Impact

**DB** (new files, gitignore-respecting)
- `DB/phase3/phase3_init.sql` — new (placeholder; no schema changes in v1).
- `DB/phase3/phase3_procedures.sql` — new (7 SPs: `fn_accounts_summary`, `fn_accounts_trend`, `fn_accounts_by_shop`, `fn_accounts_by_category`, `fn_accounts_top_products`, `fn_accounts_adjustments`, `fn_accounts_in_transit`).
- Reuses existing `fn_category_tree` for descendant expansion in the category filter — no changes to Phase 1/2 SPs.

**Backend** (new resource folder)
- `API/Controllers/AccountsController.cs` — new (8 GET endpoints: summary, trend, by-shop, by-category, top-products, adjustments, in-transit, export).
- `Business/DTOs/Accounts/*.cs` — new DTOs.
- `Business/Interface/IAccountsService.cs` + `Implementation/AccountsService.cs` — new.
- `Business/Validators/Accounts/*.cs` — new (date-range bounds, group-by enum).
- `Repository/Interface/IAccountsRepository.cs` + `Implementation/AccountsRepository.cs` — new.
- `Repository/Entities/Accounts*.cs` — new entity POCOs.

**Frontend** (new resource folder + sidebar nav)
- `front-end/src/api/accounts/{api,types}.ts` — new HTTP layer.
- `front-end/src/hooks/useAccounts.ts` — new TanStack Query hooks.
- `front-end/src/pages/admin/AdminAccounts.tsx` — new main page.
- `front-end/src/components/accounts/*.tsx` — new (KpiStrip, InTransitStrip, ShopBreakdownTable, CategoryBreakdownTable, TopProductsTable, AdjustmentsLogTable). (`TrendChart.tsx` was built but is no longer rendered after the simplification.)
- `front-end/src/App.tsx` — one new route.
- `front-end/src/components/Sidebar.tsx` — one new nav entry (admin only).
- `front-end/package.json` — adds `@mui/x-charts` (now unused on the dashboard after the trend chart was dropped).

**External** — none. No external service integrations, no auth changes, no migration on existing tables.

**Compatibility** — fully additive. No changes to existing endpoints, SPs, or table schemas.
