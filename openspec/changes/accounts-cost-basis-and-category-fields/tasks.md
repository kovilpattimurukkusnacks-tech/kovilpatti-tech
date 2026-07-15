# Tasks: accounts-cost-basis-and-category-fields

> **Scope reduced 12-Jul-2026 (client):** only the Purchased (at Cost) figure —
> KPI card placed before Requested + the by-shop column placed before
> Requested (MRP) — backed by a `purchase_price_snapshot` on line items so
> historical figures can't drift. The basis toggle, category GST/HSN, category
> search, and export changes from the original proposal were withdrawn and
> reverted.

## 1. Database

- [x] 1.1 One-shot migration `DB/One shot scripts/phase2_purchase_snapshot_migration.sql`: ALTER `stock_request_items` ADD `purchase_price_snapshot`, backfill from current `products.purchase_price` (approximate for old rows)
- [x] 1.2 Bake the column into `DB/phase2/phase2_init.sql` for fresh deploys
- [x] 1.3 `DB/phase2/phase2_procedures.sql`: populate the snapshot in all five insert paths (create, draft-save, update, inventory-add, return)
- [x] 1.4 `DB/phase3/phase3_procedures.sql`: re-point by-shop + by-category cost math at the snapshot; add `purchase_amount` to `fn_accounts_summary`

## 2. Backend

- [x] 2.1 `AccountsSummary` entity + `AccountsSummaryDto` + `AccountsService` mapper: `PurchaseAmount`
- [x] 2.2 Build backend

## 3. Frontend

- [x] 3.1 `api/accounts/types.ts`: `purchaseAmount` on the summary DTO
- [x] 3.2 `KpiStrip`: Purchased (at Cost) card FIRST (before Requested); also shown in the Dispatched view
- [x] 3.3 `ShopBreakdownTable`: Purchased (Cost) column before Requested (MRP)
- [x] 3.4 Build frontend

## 4. Verify

- [x] 4.1 Migration + SPs applied to dev DB; gst/hsn draft columns dropped; category SPs restored to original shape; summary `purchase_amount` (₹33,494) reconciles exactly with Σ by-shop
- [ ] 4.2 Browser check: Purchased card first in the KPI strip, Purchased column before Requested in the by-shop table
