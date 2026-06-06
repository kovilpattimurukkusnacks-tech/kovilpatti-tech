# Tasks: fix-accounts-dashboard-feedback

## 1. Database — `DB/phase3/phase3_procedures.sql` (canonical, re-runnable)

- [x] 1.1 `fn_accounts_summary`: add `requested_amount` (Σ `requested_qty × unit_price` over Order items of the `finalised` CTE, Orders only); switch `dispatched_amount` / `returns_amount` to live item-level sums (Σ `COALESCE(dispatched_qty, requested_qty) × unit_price`); update `DROP FUNCTION IF EXISTS` signature
- [x] 1.2 `fn_accounts_summary`: `net_amount` = live dispatched − live returns (adjustments stay informational — already reflected in the live dispatched)
- [x] 1.3 `fn_accounts_by_shop`: add per-shop `requested_qty`, `requested_amount` (Order items), `returned_qty` (Return items, `COALESCE(dispatched_qty, requested_qty)`), and `adjustments_amount` (qty audits anchored on `edited_at` in range, joined audit → request → shop, same shape as the summary CTE); switch `dispatched_amount` / `returns_amount` to live item-level sums; update `DROP FUNCTION IF EXISTS` signature
- [x] 1.4 `fn_accounts_by_shop`: `net_amount` = live dispatched − live returns (adjustments column informational, NOT folded in)
- [x] 1.5 Re-run the file on dev DB; verify with manual SELECTs that Σ(by-shop net) = summary net and Σ(by-shop adjustments) = summary adjustments for a range containing orders, returns, and qty edits

## 2. Backend — 5-file chain for the two changed SPs

- [x] 2.1 `Repository/Entities`: add `Requested_Amount` (+ count if added) to the summary entity; add `Requested_Qty`, `Returned_Qty`, `Requested_Amount`, `Adjustments_Amount` to the shop-row entity
- [x] 2.2 `Business/DTOs/Accounts/AccountsDtos.cs`: add matching positional fields to `AccountsSummaryDto` and `AccountsShopRowDto`
- [x] 2.3 `AccountsService` mappers: pass the new fields through
- [x] 2.4 CSV export (by-shop): add the four new columns to the header row + data rows, matching on-screen column order
- [x] 2.5 Build BE; hit `/api/accounts/summary` and `/api/accounts/by-shop` and confirm new fields appear and net includes adjustments

## 3. Frontend — shared IST date util (bug #9)

- [x] 3.1 Create `front-end/src/utils/istDate.ts` with `istToday`, `istDate(offsetDays)`, `istMondayOfThisWeek`, `istFirstOfThisMonth`, `istFirstOfPrevMonth`, `istLastOfPrevMonth` using formatToParts + UTC-space arithmetic (per design D4)
- [x] 3.2 `DateRangeFilter.tsx`: re-export `istToday` from the util (keep existing import sites working); delete its local implementation
- [x] 3.3 `AccountsFilterBar.tsx`: delete the five broken local helpers, import from the util
- [x] 3.4 `AdminAccounts.tsx`: replace local `istFirstOfThisMonth` with the util import
- [x] 3.5 Verify: temporarily set Windows TZ (or use a UTC browser profile) and confirm "Today" yields the current IST date

## 4. Frontend — FE types + KPI strip

- [x] 4.1 `api/accounts/types.ts`: add `requestedAmount` (+ count) to `AccountsSummaryDto`; add `requestedQty`, `returnedQty`, `requestedAmount`, `adjustmentsAmount` to `AccountsShopRowDto`
- [x] 4.2 `KpiStrip.tsx`: five cards in order Requested → Dispatched → Returns → Adjustments → Net; Net keeps the gold accent; grid template adjusts (e.g. `repeat(5, 1fr)` on md+, 2-col wrap on xs)

## 5. Frontend — filter bar rework

- [x] 5.1 `AccountsFilterBar.tsx`: drop the Card chrome; render content as `FilterRow`s (presets row, From/To pickers, Shops autocomplete); remove the Categories autocomplete
- [x] 5.2 Shops autocomplete chips: label with `option.name` instead of `option.code`
- [x] 5.3 Active preset highlight: compute `p.from() === filters.from && p.to() === filters.to`; active → `variant="contained"` (theme paints the gold gradient), inactive → `outlined`
- [x] 5.4 `AdminAccounts.tsx`: wrap in `FilterPanel` (collapsed by default, `useState`); pills = `dateRangeLabel(from, to)` (no ✕) + one removable pill per selected shop labelled with shop name
- [x] 5.5 Keep the `categoryIds` URL parsing + self-healing in `AdminAccounts` (old links still apply and clean themselves)

## 6. Frontend — grid polish

- [x] 6.1 All four DataGrids (`ShopBreakdownTable`, both grids in `CategoryAndProductsTable`, `AdjustmentsLogTable`): add `disableColumnMenu`
- [x] 6.2 `ShopBreakdownTable`: add Req Qty, Returned Qty, Requested (MRP), Adjustments (MRP) columns in the design-D3 order; fixed `width` on all numeric columns, `flex + minWidth` only on Shop name
- [x] 6.3 `ShopBreakdownTable`: default sort → `shopName asc`
- [x] 6.4 `CategoryAndProductsTable` (By category tab): default sort → `categoryPath asc`
- [x] 6.5 `AdjustmentsLogTable`: headers `Δ Qty` → `Qty`, `Δ Amount (MRP)` → `Amount (MRP)` (request-code link already present — verify it still works)
- [x] 6.6 Verify narrow-viewport behaviour: by-shop grid shows a horizontal scrollbar, no squished columns

## 7. Frontend — DD/MM/YYYY pickers app-wide

- [x] 7.1 `AccountsFilterBar.tsx`: both DatePickers `format="DD/MM/YYYY"`
- [x] 7.2 `DateRangeFilter.tsx`: convert the two native `type="date"` TextFields to MUI X `DatePicker` (`size="small"`, `format="DD/MM/YYYY"`, same widths, same min/max cross-constraints, emit `YYYY-MM-DD` / `''` exactly as before)
- [x] 7.3 Smoke every consumer of `DateRangeFilter` (Shop / Inventory / Admin request lists): renders, filters, Today reset button still works

## 8. Verification pass

- [x] 8.1 End-to-end on dev data: KPI Net = Σ by-shop Net; KPI Adjustments = Σ by-shop Adjustments; Requested ≥ Dispatched discrepancy visible on a partially-fulfilled order
- [x] 8.2 Presets: each of the six produces the correct IST range; clicked preset shows gold; manual edit clears it
- [x] 8.3 Filter panel: collapsed by default, pills correct (range label + shop names), ✕ on a shop pill removes it, no Categories control, cream background
- [x] 8.4 CSV by-shop export columns match the new on-screen columns
- [x] 8.5 `npm run build` (tsc) and BE build both clean

## 9. Follow-up feedback (review round 2)

- [x] 9.1 Merge Date pickers + Shops autocomplete into one FilterRow
- [x] 9.2 Remove the Adjustments KPI card → 4 cards (Requested → Dispatched → Returns → Net); grid `repeat(4, 1fr)`
- [x] 9.3 Adjustments log header shows the period total: "N edits · net effect ₹X — already included in the totals above" (summary data passed down from AdminAccounts; no extra request)
- [x] 9.4 Update spec (KPI strip = 4 cards; adjustments-total header requirement) + design D2
- [x] 9.5 Preset highlight = clicked preset only (URL `preset` param; validated against range; cleared on manual date edit; shop changes don't touch it) — fixes the This week/This month tie both showing gold
- [x] 9.6 Add shared `data-page-grid` class to all four Accounts DataGrids — cream rows/header/footer consistent with Stock Requests + Products
