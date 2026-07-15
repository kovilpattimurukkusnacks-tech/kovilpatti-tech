# HANDOFF — Kovilpatti Snacks Inventory

Compact briefing for a fresh Claude Code session (or a new machine). Read
this top-to-bottom once; then `CLAUDE.md` for conventions and `README.md`
for setup commands.

**Date of handoff**: 30-May-2026
**Next major work**: Phase 3 (accounts integration) + bug fixes.

---

## 1. Read these first (in order)

1. **`CLAUDE.md`** — project mental model, directory layout, conventions, "do nots". This is the master brief.
2. **`README.md`** — first-time setup (build / run / DB bootstrap).
3. This file — what was decided/built in the previous session and what's pending.

---

## 2. Project at a glance

- **What**: Shop-to-godown inventory management for SK's Kovilpatti Murukku & Snacks.
- **Stack**: .NET 9 (Dapper + raw SQL SPs) + React 19 + PostgreSQL 13+ (Supabase or local).
- **Roles**: Admin / Inventory / ShopUser.
- **Repo layout**:
  - `Backend/` (.NET solution: `KovilpattiSnacks.sln`)
  - `front-end/` (Vite + React)
  - `DB/phase1/`, `DB/phase2/` — canonical schema (tracked)
  - `DB/One shot scripts/` — local seeds / resets / migrations (**gitignored**)

---

## 3. Phase status

| Phase | Scope | Status |
|---|---|---|
| 1 | Master data: shops, godowns, users, categories (nested), products | ✅ done |
| 2 | Stock requests: full lifecycle, Returns, post-completion qty edit | ✅ done |
| **3** | **Accounts integration: reconciliation entries from qty-edit audits, per-shop receivables, period closures** | **Not started** |

---

## 4. What was built in the last sprint (28–30 May 2026)

Client demo (26-May-2026) gave 9 feedback items. By 30-May, items #1, #6, #7, #8, #9 are shipped; #2, #3, #4, #5 were done earlier.

| # | Feature | Layers touched |
|---|---|---|
| **#1** | Nested categories — `parent_id` self-FK, recursive CTE, cycle-prevention trigger, per-parent name uniqueness | DB + BE + FE |
| **#6** | Cascading category picker in product form + shop browse | FE only |
| **#7** | Return Stock — create return, accept return, Return chip filter on all 3 list pages, red Return pill on rows + detail | DB + BE + FE |
| **#8** | Variant-uniqueness check dropped — duplicate variants now allowed | DB + BE |
| **#9** | Admin post-completion `dispatched_qty` edit + `stock_request_qty_audits` table (foundation for Phase 3) | DB + BE + FE |

Plus several UX / brand polish items:

- **Lock toggle** — `request_lock_enabled` setting; when OFF, all Pending requests stay editable forever (BE + FE).
- **Print system redesign**:
  - 3" thermal receipt at `/print/request/:id/thermal` (shop user).
  - A4 billing picklist at `/print/request/:id` (admin/inventory) — gained an Amount column.
  - A4 cumulative batch plan at `/print/cumulative` — items + qty only, no money.
  - Centred brand header (`Kovilpatti Murukku & Snacks` + contact) shared by A4 + thermal.
  - 2-col side-by-side cards on detail pages + A4 dense grid, CSS column masonry.
  - "Printed at" inlined into the totals strip (kills the empty-last-page overflow).
- **Brand gold gradient** — sitewide replacement of solid-black primary surfaces with a metallic gold gradient (`#C28A00 → #E6B800 → #FFD700 → #FFF1A6`). Centralised in `theme.ts` (`GOLD_GRADIENT` export) + `global.css` `.gold-gradient` utility class + MUI v9 CSS safety net.
- **Cream table backdrop** (`#FFFBE6`) — Admin/Inventory/Shop request lists, products list, all data-page DataGrids, FilterBar panel, Landing page cards. Matches the warm yellow theme.
- **Inventory dispatch-drafts strip** — collapsed by default (was eating viewport with 5+ drafts).
- **AdminRequests filter persistence** — preset/shop/date/search/page state now lives in URL search params; "Back to list" uses `navigate(-1)` so filters survive the round-trip.
- **Excel import** — now accepts category by **bare name** (when unique) OR **full path** (`Biscuits > Big Biscuit`). Case-insensitive. Disabled when zero categories exist (BE 400 + FE button-disabled gate).
- **Logo / login page**: dropped "INVENTORY MANAGEMENT SYSTEM" title (logo is enough); cream cards.

---

## 5. Dev DB state (as of handoff)

If you're moving to a fresh machine and need to recreate dev:

**Canonical schema** (run on a fresh DB in order):
```
DB/phase1/phase1_init.sql
DB/phase1/phase1_procedures.sql
DB/phase1/phase1_pagination.sql
DB/phase1/phase1_products_optimizations.sql
DB/phase2/phase2_init.sql
DB/phase2/phase2_procedures.sql
```

All Phase 1 + Phase 2 features (nested categories, Returns, qty audits, etc.) are baked into the canonical files. No migration scripts needed for a fresh deploy.

**For an existing populated DB, migrations live in**: `DB/One shot scripts/` (gitignored — won't travel with the repo). Recreate locally if needed:
- `phase1_subcategories_migration.sql` — adds `parent_id`, partial unique indexes, cycle trigger.
- `phase1_drop_variant_uniqueness.sql` — drops `uq_products_variant_active` + `fn_product_variant_exists`.
- `phase2_returns_migration.sql` — adds `request_type` enum, `'Accepted'` status, `source_request_id`, etc.
- `phase2_qty_audit_migration.sql` — adds `stock_request_qty_audits` table.
- `phase3_accounts_utilities.sql` (15-Jul-2026) — adds `fn_accounts_utilities_breakdown` for the Net Profit KPI + Utilities columns on admin Dashboard / Accounts. Requires phase 4 tables (`shop_utility_expenses`) — the script guards for that and errors out clearly if phase 4 hasn't been applied.

**Optional dev seeds** (also in `One shot scripts/`):
- `phase1_seed_bulk.sql` — 500 inventories + 1000 shops + 2000 products. The big bulk seed.
- `phase1_seed_kovilpatti_demo.sql` — small demo (8 cats + 18 products).
- `phase2_seed_max_catalogue.sql` — 158 products + **5 stress-test requests at 150 line items each** (for print testing).
- `phase1_seed_categories_for_sample_import.sql` — just the categories needed by the sample CSV.
- `sample_products_import.csv` — 50-row Excel import demo.

**Resets** (also in `One shot scripts/`):
- `phase1_reset_data.sql` — wipes everything transactional, keeps admin + categories.
- `phase2_reset_catalogue_and_requests.sql` — wipes ONLY categories + products + requests; keeps users + shops + godowns.

---

## 6. Phase 3 starting points (accounts integration)

What's in place already that Phase 3 will consume:

- **`stock_request_qty_audits`** table — every post-completion `dispatched_qty` edit logged with old/new/reason/edited_by/edited_at. Phase 3 will post reconciliation entries against each row.
- **`stock_requests.source_request_id`** — Returns link back to the Order they reverse. Phase 3 finds the original posting to inverse.
- **`stock_request_items.unit_price`** — snapshot at request-time pricing (not current MRP). Phase 3 needs this for accurate accounting.
- **Three event types** Phase 3 will need to handle:
  1. Order Received → revenue / receivable on shop.
  2. Return Accepted → reverse the original posting.
  3. Post-completion qty edit → adjustment entry (sourced from the qty-audit row).

Suggested Phase 3 schema sketch (not built):
- `accounts_ledger` (id, shop_id, request_id, request_item_id, event_type, debit, credit, posted_at, reverses_ledger_id) — double-entry.
- `accounts_periods` — month-end closures.
- BE: `IAccountsService.PostFromRequestAsync(requestId)` — called from `ReceiveAsync` / `AcceptReturnAsync` / `EditDispatchedQtyAsync`.

Before writing code, **decide the closing rule**: should the ledger post at Receive time, or at Dispatch time? Different cash-flow semantics.

---

## 7. Known small issues / things to verify

- **MUI v9** — the `containedPrimary` styleOverrides slot doesn't fire. Always use `root` with `ownerState` callback (already wired in `theme.ts`) + the CSS safety net in `global.css`. If a contained primary button shows up black, check ordering of stylesheets.
- **Print last-page overflow** — fixed by inlining "Printed at" into the totals strip. If a future change re-adds a standalone footer, it'll re-introduce the empty-page bug.
- **Category name lookup is case-insensitive** but **path normalisation only trims spaces around `>`**. Don't add other separators (`/`, `\`) unless you also extend `NormalizeCategoryPath` in `ProductService.cs`.
- **Excel import is atomic** — any hard error in any row → zero products inserted. Per-row errors are returned as 200 with `errors[]`; only "no categories at all" / "bad file" return 400.
- **Cumulative print groups by `product_id`**, not by `(name, category, weight, price)` tuple. Since #8 dropped variant uniqueness, two products with the same surface fields will show as **separate lines** in the cumulative — by design.

---

## 8. Build / run quick reference

```bash
# Backend
cd Backend
dotnet build
dotnet run --project API           # → http://localhost:5219, Swagger at /swagger

# Frontend
cd front-end
npm install
npm run dev                        # → http://localhost:5173

# Default admin login
# admin / admin123  (first BE boot auto-creates from appsettings.Seed)
```

Connection string + JWT key live in **user-secrets** (per the README), not in `appsettings.json`.

---

## 9. Operational rules (do NOT)

- **Never auto-commit / push.** User drives all git operations.
- **Match scope strictly.** When asked to change one element, don't extend "for consistency" to siblings that weren't mentioned.
- **Don't run `phaseN_init.sql` on a populated DB.** Use the matching migration script under `One shot scripts/` instead.
- **Don't put one-shot SQL into `DB/phase1/` or `DB/phase2/`.** Those folders are tracked — pollution = client repo bloat. One-shots → `DB/One shot scripts/` (gitignored).
- **Don't bypass the SP layer** from .NET repositories. Always call a `fn_*` function; never raw `INSERT/UPDATE` from Dapper.

---

## 10. Where to look for tricky things

| Topic | File |
|---|---|
| MUI primary button = gold gradient | `front-end/src/theme.ts` + `front-end/src/styles/global.css` |
| Print page CSS (A4) | `front-end/src/pages/print/print.css` |
| Print page CSS (3" thermal) | `front-end/src/pages/print/thermal.css` |
| Stock-request lifecycle SPs | `DB/phase2/phase2_procedures.sql` (fn_request_*) |
| Nested-category recursive CTE | `DB/phase1/phase1_procedures.sql` (fn_category_list / get / tree) |
| Cycle-prevention trigger | `DB/phase1/phase1_init.sql` (fn_categories_no_cycle) |
| Excel import path lookup | `Backend/Business/Implementation/ProductService.cs` (ImportAsync) |
| Return / Order branching | `front-end/src/pages/inventory/InventoryRequestDetail.tsx` |
| Exception → HTTP map | `Backend/API/Middleware/ExceptionHandlingMiddleware.cs` |
| Sidebar gold gradient classes | `front-end/src/components/Sidebar.tsx` (+ ShopSidebar + InventorySidebar) |

---

Last edited: 30-May-2026. Bump this date + the "what was built" table whenever significant work lands.
