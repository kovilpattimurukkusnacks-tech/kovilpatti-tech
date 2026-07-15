# Design: accounts-cost-basis-and-category-fields

## Context

The Accounts dashboard (Phase 3) reports stock movement **at MRP** only. A cost
side already exists *partially*: `fn_accounts_by_shop` and
`fn_accounts_by_category` return `purchase_amount / profit / loss` (client #12,
17-Jun-2026), and those flow through DTOs → Excel export — but they are
**export-only** (not on screen), computed from the **current**
`products.purchase_price` (retroactively mutable), and absent from
`fn_accounts_summary` and `fn_accounts_top_products`.

Also already done since the proposal was written: the four Accounts exports are
**already `.xlsx`** via `AccountsXlsxWriter` + ClosedXML 0.104.1 — the
proposal's "switch CSV → Excel" item is complete and drops out of scope.

Remaining gaps this change closes:

1. No cost snapshot on line items — cost figures drift when admin edits a
   product's purchase price.
2. No cost columns on summary / top-products.
3. No on-screen cost view — no MRP/Cost basis toggle, no "Purchased (at Cost)"
   KPI.
4. Categories lack `gst_rate` / `hsn_code`.
5. Categories master page has no search box.

## Goals / Non-Goals

**Goals:**
- Freeze `purchase_price_snapshot` on line items at insert time, mirroring the
  existing `unit_price` (MRP) snapshot; backfill existing rows best-effort.
- Re-point all `fn_accounts_*` cost math at the snapshot.
- Return cost amounts from all four breakdown SPs; add a `basis` toggle
  (URL param, default `mrp`) that re-bases KPI cards and money columns
  client-side with no re-fetch.
- Add a **Purchased (at Cost)** KPI figure and per-shop column.
- Add `gst_rate` + `hsn_code` to categories (storage + form only).
- Client-side search box on the Categories page.

**Non-Goals:**
- No CSV work (exports are already Excel).
- No invoice/GST computation — gst/hsn are storage-only.
- No changes to the request-lifecycle UI; snapshot capture is invisible there.
- No server-side category search (list is fully loaded already).
- `fn_accounts_trend` stays untouched (unused).

## Decisions

**D1 — Snapshot from `products.purchase_price` inside the SPs, not the JSON
payload.** The four item-inserting SPs (`fn_request_create`,
`fn_request_update`, `fn_request_inventory_add_items`,
`fn_request_create_return`) already join/SELECT from `products` for
weight fields; reading `p.purchase_price` there costs nothing and avoids
touching the API payload shape, DTOs, validators, and FE request builders.
Alternative (client-sent value like `unit_price`) rejected: wider blast
radius and lets a stale client freeze a stale price.

- Column: `purchase_price_snapshot numeric(10,2) NULL` (NULL = product had no
  purchase price at insert; accounts math COALESCEs to 0, matching today).
- No generated cost-subtotal column — nothing consumes it; YAGNI.

**D2 — Cost math: `COALESCE(it.purchase_price_snapshot, 0)` replaces
`COALESCE(p.purchase_price, 0)`** in by-shop and by-category, and the same
expression is added to summary and top-products (same qty COALESCE chains as
the MRP amounts). The `LEFT JOIN products` stays where needed for category
filtering but is no longer the price source. Retroactive-drift limitation in
the SP comments is resolved and the comments updated.

**D3 — Backfill = one-shot migration under `DB/One shot scripts/`** (per
CLAUDE.md rules), plus baking the column into `phase2_init.sql` for fresh
deploys. Backfill sets `purchase_price_snapshot = p.purchase_price` from the
current product row — approximate for historical rows, exact from deploy
forward. No flag column; the approximation is documented in the migration
header. Rollback = drop column (accounts falls back gracefully since SPs are
re-runnable; re-run the previous procedures file).

**D4 — Basis toggle is pure client state.** All SPs return both MRP and cost
amounts unconditionally; `basis` (`mrp` | `cost`) lives only in the URL
(mirrors the existing `view` param in `AdminAccounts`) and switches which
fields KpiStrip / ShopBreakdownTable / CategoryAndProductsTable display and how
money labels read ("(at MRP)" ↔ "(at Cost)"). No backend `basis` param, no
re-fetch. Excel exports keep emitting **both** column sets (already do for
by-shop/by-category; top-products gains cost columns) — an export shouldn't
lose data based on a UI toggle.

**D5 — KPI strip in cost basis.** MRP basis renders exactly today's four cards.
Cost basis re-bases Requested/Dispatched/Returns/Net onto the cost fields and
retitles the strip's money labels; the Net-at-cost card is the "Purchased
(at Cost)" figure from proposal item #4 (net dispatched cost = Σ order cost −
Σ return cost). Profit/Loss stay in the by-shop/by-category tables and exports
only — no new KPI card count, keeping the strip stable for the non-technical
audience.

**D6 — Category fields.** `gst_rate numeric(5,2) NULL`, `hsn_code varchar(8)
NULL`, exposed through `fn_category_list/get/tree` (RETURNS TABLE change ⇒
`DROP FUNCTION IF EXISTS` guards, same pattern as the existing
`fn_category_list` guard) and new optional params on
`fn_category_create/update`. Validation: `gst_rate` between 0 and 100;
`hsn_code` 4–8 digits when present. Children do NOT inherit values implicitly —
each category row stores its own (inheritance is a consumer concern for the
future invoicing feature).

**D7 — Category search is client-side.** A TextField in the Categories toolbar
filters the loaded tree by case-insensitive name match; an ancestor chain of a
matching node stays visible so the tree keeps its shape, and matching parents
auto-expand. No API change.

## Risks / Trade-offs

- [Backfilled cost is approximate for pre-migration rows] → documented in the
  migration header and design; new rows exact. Accepted in proposal.
- [Products with no purchase price contribute ₹0 cost, inflating profit] →
  matches existing by-shop behaviour; COALESCE(…, 0) keeps totals stable.
  Surfacing a "N items had no cost" hint is deferred.
- [RETURNS TABLE changes require DROP FUNCTION] → use `DROP FUNCTION IF
  EXISTS` guards in the re-runnable procedures files (established pattern).
- [4 SP insert paths must all set the snapshot] → covered one-by-one in tasks;
  missing one silently produces NULL (→ ₹0 cost), so verify each path.

## Migration Plan

1. Run one-shot `phase2_cost_snapshot_and_category_gst_migration.sql`
   (ALTER stock_request_items + backfill; ALTER categories).
2. Re-run `phase1_procedures.sql`, `phase2_procedures.sql`,
   `phase3_procedures.sql` (all CREATE OR REPLACE / guarded DROPs).
3. Deploy backend, then frontend. Order-safe: old FE ignores new payload
   fields; new FE tolerates missing cost fields as 0/undefined only briefly.

## Open Questions

None — proposal decisions carried through; Excel-export scope removed as
already shipped.
