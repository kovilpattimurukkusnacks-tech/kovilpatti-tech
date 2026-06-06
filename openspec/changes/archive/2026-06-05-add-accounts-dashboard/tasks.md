## 1. Database — `DB/phase3/`

- [x] 1.1 Create `DB/phase3/` directory and add `phase3_init.sql` as a placeholder with the standard `BEGIN; COMMIT;` shell and a header comment explaining it is a no-op for v1 (no new tables).
- [x] 1.2 Create `DB/phase3/phase3_procedures.sql` with `CREATE OR REPLACE FUNCTION fn_accounts_summary(p_from date, p_to date, p_shop_ids uuid[], p_inv_ids uuid[], p_cat_ids int[])` returning a single row with: `dispatched_amount`, `dispatched_request_count`, `returns_amount`, `returns_request_count`, `net_amount`, `active_shop_count`, `adjustments_amount`, `adjustments_count`. SP converts IST calendar dates to a `[from 00:00 IST, (to+1) 00:00 IST)` UTC half-open range internally. **NOTE:** `p_cat_ids` is `int[]` (not `uuid[]`) because `categories.id` is `serial`.
- [x] 1.3 Add `fn_accounts_trend(p_from, p_to, p_grouping varchar, p_shop_ids, p_inv_ids, p_cat_ids)` returning `(bucket_start date, dispatched_amount numeric, returns_amount numeric, net_amount numeric)`. Bucket via `date_trunc(p_grouping, anchor AT TIME ZONE 'Asia/Kolkata')`. Generate the full bucket series with `generate_series` so empty buckets appear as zero.
- [x] 1.4 Add `fn_accounts_by_shop(p_from, p_to, p_shop_ids, p_inv_ids, p_cat_ids)` returning per-shop rows: `shop_id, shop_code, shop_name, order_request_count, return_request_count, dispatched_qty, dispatched_amount, returns_amount, net_amount`. `dispatched_qty` uses `COALESCE(item.dispatched_qty, item.requested_qty)`.
- [x] 1.5 Add `fn_accounts_by_category(p_from, p_to, p_shop_ids, p_inv_ids, p_cat_ids)` returning per-leaf-category rows: `category_id, category_path, quantity, amount`. `category_path` uses the same ` > ` separator as `fn_category_tree`. Returns sign-aware: Returns subtract from category totals so the category Net matches the page-level Net KPI.
- [x] 1.6 Add `fn_accounts_top_products(p_from, p_to, p_shop_ids, p_inv_ids, p_cat_ids, p_limit int)` returning top-N products by `amount` descending: `product_id, product_code, product_name, weight_value, weight_unit, quantity, amount`. Same sign-aware semantics as by-category.
- [x] 1.7 Add `fn_accounts_adjustments(p_from, p_to, p_shop_ids, p_inv_ids, p_cat_ids)` joining `stock_request_qty_audits → stock_request_items → stock_requests → shops, products, users`. Filter by `edited_at` falling in the IST half-open range. Returns: `audit_id, edited_at, request_id, request_code, shop_id, shop_name, product_id, product_name, weight_value, weight_unit, old_qty, new_qty, delta_qty, unit_price, delta_amount, reason, edited_by_id, edited_by_name`. `delta_amount = (COALESCE(new_qty,0) - COALESCE(old_qty,0)) * unit_price`.
- [x] 1.8 Add `fn_accounts_in_transit(p_shop_ids, p_inv_ids)` returning a single row: `request_count, total_amount, oldest_dispatched_at`. Filter on `status='Dispatched' AND request_type='Order' AND is_deleted=false`. Ignores the date range params by design.
- [x] 1.9 All SPs MUST be SELECT-only — verified: `grep -i -E '^\s*(INSERT|UPDATE|DELETE|MERGE)\s' phase3_procedures.sql` returns nothing.
- [ ] 1.10 Apply `phase3_procedures.sql` against local dev DB; manually call each SP with `SELECT * FROM fn_accounts_summary('2026-05-01','2026-05-31',NULL,NULL,NULL);` and confirm shapes match the DTOs in section 2. **(manual — needs running DB)**
- [ ] 1.11 Run `EXPLAIN ANALYZE` for `fn_accounts_summary` and `fn_accounts_by_shop` over a 90-day range on the seeded stress DB. If any plan reads >50% of `stock_requests` with no index use, add a one-shot migration `DB/One shot scripts/phase3_indexes.sql` with partial indexes on `(received_at)` and `(accepted_at)` filtered by status. **(manual — needs running DB)**

## 2. Backend — Repository layer

- [x] 2.1 Create `Backend/Repository/Entities/Accounts/{AccountsSummary, AccountsTrendBucket, AccountsShopRow, AccountsCategoryRow, AccountsProductRow, AccountsAdjustmentRow, AccountsInTransit}.cs` with `PascalCase_With_Underscores` property names matching SP column names.
- [x] 2.2 Create `Backend/Repository/Interface/IAccountsRepository.cs` with one async method per SP. Filters take nullable typed parameters; null/empty arrays = no filter.
- [x] 2.3 Create `Backend/Repository/Implementation/AccountsRepository.cs` calling the SPs via Dapper. Arrays passed as `Guid[]?` / `int[]?`; Postgres maps them to `uuid[]` / `int[]` natively.
- [x] 2.4 Register `IAccountsRepository → AccountsRepository` in `Backend/Repository/DependencyInjection.cs`.

## 3. Backend — Business layer

- [x] 3.1 Create `Backend/Business/DTOs/Accounts/AccountsDtos.cs` with all DTO records using camelCase positional names matching the FE `types.ts`.
- [x] 3.2 Create `Backend/Business/DTOs/Accounts/AccountsFilters.cs` — class with `From DateOnly?, To DateOnly?, ShopIds Guid[]?, InventoryIds Guid[]?, CategoryIds int[]?, Grouping string?, Limit int?`.
- [x] 3.3 Create `Backend/Business/Validators/Accounts/AccountsFiltersValidator.cs` (FluentValidation): `From` / `To` required, `From <= To`, span ≤ 366 days, `Grouping in {day,week,month}`, `Limit in {10,25,50}` when present.
- [x] 3.4 Create `Backend/Business/Interface/IAccountsService.cs` mirroring repository methods.
- [x] 3.5 Create `Backend/Business/Implementation/AccountsService.cs`. Each method validates filters, re-checks Admin role (defence in depth — controller is already `[Authorize(Roles = "Admin")]`), calls repo, maps entity → DTO.
- [x] 3.6 Register `IAccountsService → AccountsService` in `Backend/Business/DependencyInjection.cs`.

## 4. Backend — API layer

- [x] 4.1 Create `Backend/API/Controllers/AccountsController.cs` with `[Authorize(Roles = "Admin")]` and `[Route("api/accounts")]`.
- [x] 4.2 Add 7 GET JSON endpoints: `summary, trend, by-shop, by-category, top-products, adjustments, in-transit` — each binds `AccountsFilters` from the query string.
- [x] 4.3 Add 4 CSV export GET endpoints under `/api/accounts/export`. Each returns `FileStreamResult` with `text/csv; charset=utf-8` and `Content-Disposition: attachment; filename=accounts-<table>_<from>_to_<to>.csv`. Stream is BOM-prefixed by `AccountsCsvWriter`.
- [x] 4.4 Create `Backend/Business/Implementation/AccountsCsvWriter.cs` — RFC 4180 escaping (quote on `, " \r \n`; double internal quotes), CRLF line terminator, UTF-8 BOM, shared cell formatters (`FormatIst`, `FormatIso`, `FormatAmount`, `FormatInt`).
- [x] 4.5 Add `Backend/API/Middleware/CommaSeparatedArrayModelBinder.cs` so `?shopIds=a,b` / `?categoryIds=1,2` bind to `Guid[]?` / `int[]?` per the spec convention. Registered globally in `Program.cs` (only fires for `Guid[]` / `int[]`).
- [ ] 4.6 Verify with Swagger that all 11 routes show up under `AccountsController`, all marked `Admin`-only. **(manual — needs running BE)**
- [ ] 4.7 Manually `curl` each endpoint with a valid Admin JWT in dev; confirm shape matches DTOs and timestamps are ISO 8601 UTC. **(manual — needs running BE)**

## 5. Frontend — API + hooks layer

- [x] 5.1 Install `@mui/x-charts ^9.3.0` via `npm install --save @mui/x-charts`. `package.json` + `package-lock.json` updated.
- [x] 5.2 Create `front-end/src/api/accounts/types.ts` with TypeScript types mirroring the BE DTOs and an `AccountsFilters` interface for query construction.
- [x] 5.3 Create `front-end/src/api/accounts/api.ts` exporting one function per BE endpoint and four `accountsExport.*` download helpers. **Deviated from the original task wording:** uses `fetch + blob + URL.createObjectURL + <a download>` rather than a plain `<a href>` because the JWT lives in localStorage (not a cookie) — a naked navigation would download an unauthenticated 401 page. Payload size for any realistic range is well under 1 MB so in-memory is fine.
- [x] 5.4 Create `front-end/src/hooks/useAccounts.ts` with one TanStack Query hook per endpoint. Query keys include the full filter object; stale time 30s.

## 6. Frontend — page + components

- [x] 6.1 Create `front-end/src/components/accounts/` folder.
- [x] 6.2 Build `KpiStrip.tsx` — 4 cards. Net card uses `GOLD_GRADIENT`; others are cream. Currency via `formatINR` (en-IN). Every ₹ label reads "(at MRP)".
- [x] 6.3 Build `TrendChart.tsx` using `@mui/x-charts`'s `<BarChart>` for Dispatched/Returns (grouped bars) + `<LineChart>` overlay for Net. Two charts stacked because v9 mixed series + bar grouping is awkward in a single chart.
- [x] 6.4 Build `InTransitStrip.tsx` — dashed-border card showing count, total ₹, and age (days) of the oldest in-transit Order. Returns `null` when count is 0 (collapsed; no reserved space).
- [x] 6.5 Build `ShopBreakdownTable.tsx` (MUI X DataGrid). Default sort: Net desc. Row click → `/admin/requests?shopId=…&from=…&to=…`. Export CSV button at top right.
- [x] 6.6 Build `CategoryAndProductsTable.tsx` — tabbed: by-category + top-products. Top products has an N-selector (10/25/50). Each tab has its own Export CSV button.
- [x] 6.7 Build `AdjustmentsLogTable.tsx` (DataGrid). Sort: `editedAt` desc. Δ ₹ red when negative, green when positive. Request code links to `/admin/requests/:id`. Export CSV button.
- [x] 6.8 Build `AdminAccounts.tsx` page wiring filter bar → KpiStrip → InTransitStrip → TrendChart → ShopBreakdownTable → CategoryAndProductsTable → AdjustmentsLogTable. Filter state lives in URL via `useSearchParams`.
- [x] 6.9 Build `AccountsFilterBar.tsx` with presets (Today / Yesterday / This week / Last 30 days / This month / Last month), grouping select, three multi-select Autocompletes (shops / godowns / categories). Reuses `useShops` / `useInventories` / `useCategories`.
- [x] 6.10 Add route in `front-end/src/App.tsx`: `<Route path="accounts" element={<AdminAccounts />} />` inside the `/admin` protected group.
- [x] 6.11 Add sidebar entry in `front-end/src/components/Sidebar.tsx`: "Accounts" link with `Receipt` icon. Lives inside the admin-only Sidebar so no extra role check needed.
- [x] 6.12 `npx tsc --noEmit` clean; `npm run build` succeeds.

## 7. Manual verification (run locally — needs both BE + FE up)

- [ ] 7.1 Run BE + FE locally with the stress-seed DB. Navigate to `/admin/accounts`. Confirm default range is current IST week and the dashboard renders without errors.
- [ ] 7.2 Verify KPI math against a hand-rolled SQL query: pick a single shop and a 3-day range, sum dispatched amounts manually, compare to dashboard.
- [ ] 7.3 Test IST boundary: create an Order with `received_at` near 18:30 UTC (= 00:00 IST next day) and confirm it falls in the correct date bucket.
- [ ] 7.4 Make a qty edit via the existing admin edit flow; refresh the dashboard; confirm the edit shows in the Adjustments log with correct Δ ₹.
- [ ] 7.5 Export each CSV; open in Excel and confirm Tamil shop names render correctly (no mojibake — BOM should handle this).
- [ ] 7.6 Test category filter: select a parent category with children; confirm child-category products show in breakdowns.
- [ ] 7.7 Test as ShopUser + Inventory user: confirm Accounts sidebar entry is absent and direct navigation to `/admin/accounts` is denied (RoleGate sends them to their own home).
- [ ] 7.8 Submit an invalid range (`from > to`, range > 366 days, missing `to`) and confirm the API returns HTTP 400 with field errors.
- [ ] 7.9 Smoke test existing pages (Requests, Products, Shops) — no regression from the `@mui/x-charts` install.
- [ ] 7.10 Refresh `/admin/accounts` while filters are active; confirm filters survive in the URL.

## 8. Cleanup

- [x] 8.1 Update `CLAUDE.md`'s "Recent feature work" section with the Accounts dashboard row and refresh the "Last updated" date to 01-Jun-2026. Phase 3 folder added to the directory layout block.
- [x] 8.2 Update `README.md`: new `/api/accounts/*` endpoints in the API table; `phase3/` folder added to the directory layout.
- [x] 8.3 Run `openspec validate add-accounts-dashboard` — **green**. All 4 artifacts complete.
