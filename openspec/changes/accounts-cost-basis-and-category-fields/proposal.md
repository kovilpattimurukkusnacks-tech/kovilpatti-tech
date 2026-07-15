# Proposal: accounts-cost-basis-and-category-fields

> **Scope reduced 12-Jul-2026 (client):** implemented only the Purchased
> (at Cost) figure (KPI card + by-shop column, both before Requested) on top
> of a `purchase_price_snapshot`. Items #2 (GST/HSN), #3 (Excel — already
> shipped separately), #5 (category search) and the MRP/Cost basis toggle
> were withdrawn. See tasks.md for what actually landed.

## Why

The Accounts dashboard only shows value **at MRP** (retail) — the owner can see
how much stock moved at selling price but never what it *cost*, so gross margin
is invisible. Adding a cost (purchase-price) basis turns the dashboard from a
"movement at retail" report into a margin-aware one. Alongside that, three
smaller asks from the same review: categories need GST/HSN fields for future
invoicing, the long category list needs a search box, and finance users want
Excel exports they can open and pivot directly rather than raw CSV.

## What Changes

**Cost basis view (items #1 + #4):**

- Line items gain `purchase_price_snapshot`, frozen at submit time exactly like
  the existing `unit_price` (= MRP snapshot). A one-shot migration ALTERs the
  column and backfills existing rows best-effort from the product's current
  `purchase_price` (flagged approximate). **BREAKING** for historical accuracy
  only on pre-existing rows — new rows are exact.
- `fn_accounts_summary / _by_shop / _by_category / _top_products` each return
  **both** the existing MRP amounts and parallel **cost** amounts.
- The Accounts filter gains a **MRP / Cost** basis toggle (URL param `basis`,
  default MRP). Switching it instantly re-bases every KPI card, by-shop row,
  by-category row and top-product row — no re-fetch (both amounts already in
  the payload).
- A **Purchased (at Cost)** figure appears in the KPI strip and the by-shop
  table per item #4.

**Category GST + HSN (item #2):**

- `categories` gains `gst_rate numeric(5,2)` and `hsn_code varchar(8)`. Surfaced
  in the category form and tree SPs. Storage-only for now — no invoice or export
  consumes them yet; HSN is stored per-category as a simplification (products
  inherit their category's code).

**Excel export (item #3):**

- The four Accounts exports switch from CSV to `.xlsx` (ClosedXML, already a
  dependency). Buttons relabel to "Export Excel". **BREAKING**: CSV exports are
  removed.

**Category search (item #5):**

- A client-side search box on the Categories master page filters the loaded
  tree by name. FE-only.

## Capabilities

### New Capabilities

- `category-management`: master-data behaviour for categories — nesting, the
  GST/HSN fields, and the admin-page search/filter. (No prior spec existed;
  this captures the category requirements touched here.)

### Modified Capabilities

- `accounts-reporting`: KPI strip, by-shop, by-category and top-products gain a
  cost basis alongside MRP; the filter gains a basis toggle; exports become
  Excel instead of CSV.

## Impact

- **DB** — `DB/phase2/phase2_init.sql` (+`purchase_price_snapshot` for fresh
  deploys), `DB/phase2/phase2_procedures.sql` (submit/update SPs populate it),
  `DB/phase1/phase1_init.sql` (+category GST/HSN), `DB/phase1/phase1_procedures.sql`
  (`fn_category_*`), `DB/phase3/phase3_procedures.sql` (4 `fn_accounts_*` return
  cost columns). One-shot `DB/One shot scripts/` migration: ALTER line items +
  backfill, ALTER categories.
- **Backend** — Accounts: 5-file chain on summary + shop entities/DTOs/mappers/
  FE types; new `AccountsXlsxWriter` replacing `AccountsCsvWriter`; export
  endpoints content-type + filename. Categories: `CategoryDto`,
  Create/Update requests, validators, service mappers, entity.
- **Frontend** — `AccountsFilterBar` (basis toggle), `KpiStrip`,
  `ShopBreakdownTable`, `CategoryAndProductsTable`, `AdminAccounts` (basis URL
  state), `api/accounts/{api,types}.ts` (Excel download + cost fields);
  `Categories.tsx` (GST/HSN form fields + search box), `api/categories/types.ts`.
- **No new dependencies** — ClosedXML already present.
- New rows are cost-exact; pre-migration rows carry an approximate backfilled
  cost (documented).
