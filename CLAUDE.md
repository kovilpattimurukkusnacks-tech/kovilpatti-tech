# CLAUDE.md — Kovilpatti Snacks Inventory

Project-level guide for Claude Code sessions and new contributors. Read this
first to get the mental model before touching code. The repo also has a
`README.md` with setup/run steps — this file complements it with conventions,
recent feature deltas, and the "do not" rules.

---

## What this product is

A **shop-to-godown stock-request workflow** for the SK's Kovilpatti Murukku
& Snacks retail business. Shops request stock from a central godown
(inventory); the godown picks/packs/dispatches; shops confirm receipt; a
return path moves goods back when needed.

Three personas:

| Role | What they do |
|---|---|
| **ShopUser** | Browses the catalogue, builds a request, submits, receives goods. Also raises Returns. |
| **Inventory** | Sees incoming requests, packs & dispatches, accepts Returns at the godown. Sees a cumulative kitchen batch plan. |
| **Admin** | Master data (shops, godowns, users, products, categories), settings (cutoff time, lock toggle), and post-completion qty edits (audit-tracked). |

Phases:

- **Phase 1** — master data: shops, inventories, users, categories, products.
- **Phase 2** — stock requests: full lifecycle, Returns, audit trail.
- **Phase 3** — accounts integration (planned; uses the qty-edit audit trail). Not built.

---

## Tech stack

**Backend** (`Backend/`)
- .NET 9 Web API in `API → Business → Repository` clean-architecture layout
- **Dapper** + raw PostgreSQL stored functions (no EF / ORM)
- **FluentValidation** for request DTOs
- **JWT bearer** auth, **BCrypt** password hashing
- **ClosedXML** for Excel import parsing
- `KovilpattiSnacks.sln` at the root of `Backend/`

**Database** (`DB/`)
- PostgreSQL 13+ / Supabase
- All read+write logic lives in `CREATE FUNCTION` SPs; .NET is a thin Dapper caller
- Audit columns (`created_by/at`, `updated_by/at`) on every table
- Soft-delete via `is_deleted boolean` separate from the business `active` flag
- Sequences power code generation: `seq_product_code` → `P001`, `seq_request_code` → `REQ0001`

**Frontend** (`front-end/`)
- React 19 + TypeScript + Vite 8
- **MUI v9** (Material UI 9.0 — note: split `containedPrimary` slot is gone, use `ownerState` callback or CSS-class override)
- **MUI X DataGrid** for list tables
- **Tailwind v4** via `@import "tailwindcss"` in `global.css`
- **TanStack Query 5** for server state
- **React Router 7**
- **lucide-react** icons
- Brand display font: **Bebas Neue** (Google Fonts)

---

## Directory layout

```
Kovilpatti-Prod/
├── CLAUDE.md                        ← this file
├── README.md                        ← setup / run steps
├── .gitignore                       ← excludes DB/One shot scripts/
│
├── DB/
│   ├── phase1/                      ← canonical Phase 1 schema (TRACKED)
│   │   ├── phase1_init.sql          fresh schema + tables + indexes
│   │   ├── phase1_procedures.sql    stored functions (CREATE OR REPLACE)
│   │   ├── phase1_pagination.sql    addendum: list-pagination SP variants
│   │   └── phase1_products_optimizations.sql  addendum: seq_product_code + fn_product_create_bulk
│   │
│   ├── phase2/                      ← canonical Phase 2 schema (TRACKED)
│   │   ├── phase2_init.sql          stock_requests + stock_request_items + qty_audits
│   │   └── phase2_procedures.sql    all request SPs (create, dispatch, receive, return, etc.)
│   │
│   ├── phase3/                      ← canonical Phase 3 schema (TRACKED)
│   │   ├── phase3_init.sql          placeholder (no new tables in v1)
│   │   └── phase3_procedures.sql    read-only accounts reporting SPs (fn_accounts_*)
│   │
│   └── One shot scripts/            ← GIT-IGNORED — local seeds, resets, migrations
│       ├── phase1_seed_kovilpatti_demo.sql
│       ├── phase1_seed_bulk.sql                   500 inventories + 1000 shops + 2000 products
│       ├── phase1_seed_categories_for_sample_import.sql
│       ├── phase1_reset_data.sql                  wipes EVERYTHING transactional
│       ├── phase2_seed_max_catalogue.sql          158 products + 5 stress-test requests
│       ├── phase2_reset_catalogue_and_requests.sql  wipes only catalogue + requests
│       └── sample_products_import.csv             50-row Excel import demo
│
├── Backend/
│   ├── KovilpattiSnacks.sln
│   ├── API/
│   │   ├── Controllers/             one controller per resource
│   │   ├── Middleware/              ExceptionHandlingMiddleware (maps Business exceptions → HTTP)
│   │   ├── Program.cs               DI wiring, JWT, CORS, OpenAPI
│   │   └── appsettings*.json
│   ├── Business/
│   │   ├── DTOs/                    one folder per resource (StockRequests/, Categories/, …)
│   │   ├── Validators/              FluentValidation rules
│   │   ├── Interface/               I*Service contracts
│   │   ├── Implementation/          service classes
│   │   ├── Exceptions/              ValidationException, NotFoundException, ForbiddenException, …
│   │   └── Constants/               RoleNames, etc.
│   └── Repository/
│       ├── Entities/                Plain POCOs mapped from SP rows (snake_case_with_underscores)
│       ├── Interface/               I*Repository contracts
│       ├── Implementation/          Dapper SP callers
│       └── Data/                    IDbConnectionFactory (Npgsql)
│
└── front-end/
    ├── package.json
    ├── index.html                   Google Fonts (Plus Jakarta + DM Serif + Bebas Neue)
    ├── public/logo.png
    └── src/
        ├── main.tsx                 QueryClient + Theme + Router
        ├── App.tsx                  routes (admin / shop / inventory / print)
        ├── theme.ts                 MUI theme — exports GOLD_GRADIENT(_HOVER)
        ├── styles/global.css        Tailwind import + .gold-gradient utility + brand bg
        ├── api/                     pure HTTP layer
        │   ├── client.ts            fetch wrapper — JWT, 401, error mapping
        │   ├── errors.ts            ApiError / ValidationError / NotFoundError
        │   ├── tokenStore.ts        JWT in localStorage + UNAUTHORIZED_EVENT
        │   └── <resource>/{api,types}.ts
        ├── hooks/                   React Query hooks (one file per resource)
        ├── pages/
        │   ├── shop/                ShopRequests, ShopRequestNew, ShopRequestDetail
        │   ├── inventory/           InventoryRequests, InventoryRequestDetail
        │   ├── admin/               AdminRequests, AdminRequestDetail, AdminSettings
        │   ├── print/               PrintRequestPicklist (A4 billing), PrintCumulative (A4 kitchen),
        │   │                        PrintRequestThermal (3" receipt) + print.css + thermal.css
        │   └── Products / Categories / Shops / Inventories / Staff / Landing
        └── components/              Sidebar, PageHeader, FilterBar, ConfirmDialog, DispatchedCell, …
```

---

## Domain model — stock request lifecycle

```
Order:    Draft → Pending → Approved → Dispatched → Received
                       ↓                              ↑
                   Rejected, Cancelled            (terminal)

Return:   Pending → Accepted
                ↓
            Rejected, Cancelled
```

- `stock_requests.request_type` ∈ `Order` (shop → godown) or `Return` (goods back).
- `dispatched_qty` column is **reused** to mean "accepted_qty" on a Return — same numeric column, different semantics by `request_type`.
- Returns set `editable_until = now() + 100 years` so the lock-window logic stays uniform.
- `source_request_id` on a Return optionally links to the Order being reversed (Phase 3 accounts uses this).

---

## DB conventions

**Run order**:
1. `phase1_init.sql` (one-time fresh schema)
2. `phase1_procedures.sql` (re-runnable; uses `CREATE OR REPLACE`)
3. `phase1_pagination.sql` + `phase1_products_optimizations.sql` (idempotent addendums)
4. `phase2_init.sql` (one-time)
5. `phase2_procedures.sql` (re-runnable)

For **upgrades on an existing dev DB**: scripts live in `DB/One shot scripts/`. Each migration is idempotent (`CREATE TABLE IF NOT EXISTS`, `DROP IF EXISTS`, etc.).

**Naming convention**:
- `phase{N}_init.sql` / `phase{N}_procedures.sql` → canonical (tracked).
- `phase{N}_pagination.sql` / `phase{N}_products_optimizations.sql` → idempotent addendums (tracked).
- `phase{N}_*_migration.sql` → one-shot delta for an existing deploy (gitignored under `DB/One shot scripts/`).
- `phase{N}_seed_*.sql` → demo / stress-test data (gitignored).
- `phase{N}_reset_*.sql` → wipe scripts (gitignored).

**Categories** are nested (self-FK on `parent_id`):
- Names are case-insensitively unique **per parent** (two partial unique indexes).
- A cycle-prevention trigger walks the parent chain on INSERT/UPDATE.
- `fn_category_tree()` returns a flat root-first list with `path` (` > `-joined) and `depth`.

**Variant uniqueness is OFF**:
- The old `uq_products_variant_active` index + `fn_product_variant_exists` SP were dropped per client #8 (28-May-2026).
- Two products can share the exact `(name, category, type, weight, weight_unit)` tuple — they only differ on auto-assigned P-code.

---

## Backend conventions

**Layering** — keep these flows intact:

- Controllers stay thin (just attribute routing + service call).
- Services own business validation + role gating + SP orchestration.
- Repositories own SQL strings + Dapper plumbing. Never call services back.
- Exceptions thrown from Business are mapped to HTTP by `ExceptionHandlingMiddleware`:
  - `ValidationException` → 400 + `{ error, errors: { field: [msg…] } }`
  - `NotFoundException` → 404
  - `UnauthorizedException` → 401
  - `ForbiddenException` → 403
  - Others → 500

**Role gating**:
- Controllers use `[Authorize(Roles = "…")]` for coarse gating.
- Services re-check via `currentUser.Role` for any business rule that depends on scope (own shop / own godown).

**DTO ↔ entity naming**:
- Entities (`Repository/Entities/*.cs`) use **PascalCase with underscores** — `Shop_Code`, `Total_Dispatched_Qty` — to match Dapper's case-insensitive map against snake_case SP columns.
- DTOs use **camelCase**-style record positional names — `ShopCode`, `TotalDispatchedQty`. Mappers in services translate.

**Adding a field to StockRequestDto**:
1. SP `fn_request_get` (and list variants if needed) — add to `RETURNS TABLE` + `SELECT`.
2. `StockRequest.cs` entity — add the snake-cased property.
3. `StockRequestDto.cs` — add a positional record field.
4. `StockRequestService.MapHeaderToDto` — pass it through.
5. FE `types.ts` `StockRequestDto` — add the camelCase prop.

Cuts across 5 files, but mechanical.

---

## Frontend conventions

**State**:
- Server state → `@tanstack/react-query`. Each resource has `useResource` (query) + `useCreate/Update/DeleteResource` (mutations).
- URL state → `useSearchParams` for filters that should survive a detail-page round-trip (already wired on `AdminRequests`).
- Component state → `useState` for transient UI (open dialogs, expanded rows).

**Brand colours**:
- Gold gradient (`linear-gradient(90deg, #C28A00 0%, #E6B800 35%, #FFD700 65%, #FFF1A6 100%)`) on:
  - Every `variant="contained" color="primary"` button (via theme `MuiButton.root` ownerState callback + a CSS safety net in `global.css` for MUI v9's split class names).
  - Sidebar active nav items (via `.gold-gradient` utility class).
  - Avatar bubble.
  - Category-card headers on detail pages + new-request screen.
- Cream `#FFFBE6` on table rows + filter panel + landing cards.
- Yellow `#FCD835` accent (logo, weight strips).
- Red `#C62828` for destructive / Return semantics.

**Print pages** (no sidebar, auto-fires `window.print()`):
- `/print/request/:id` — A4 billing picklist (admin/inventory).
- `/print/request/:id/thermal` — 3" thermal receipt (shop user).
- `/print/cumulative` — A4 kitchen batch plan.

Each route is gated by a `<PrintGate>` that drops the layout chrome. The "Printed at" timestamp is **inlined into the totals strip**, not in a standalone footer — keeps near-full pages from spilling onto an empty second sheet.

**Excel import** (`Products.tsx` → `ImportProductsDialog`):
- Accepts `.xlsx` / `.csv` with headers `name, category, type, weight_value, weight_unit, mrp, purchase_price, active`.
- `category` cell can be **bare leaf name** (when unique) OR **full path** (e.g., `Biscuits > Big Biscuit`).
- Case-insensitive match.
- Variant dedup is OFF — duplicate rows insert two product rows with distinct P-codes.

---

## Recent feature work (28–29 May 2026)

| # | Feature | Status |
|---|---|---|
| **#1** | Nested categories (parent_id, recursive CTE, cycle guard) | ✅ DB + BE + FE |
| **#6** | Cascading category picker in product form + shop browse | ✅ FE only |
| **#7** | Return Stock flow (create return, accept return, Return chip filter) | ✅ DB + BE + FE |
| **#8** | Relax variant uniqueness — duplicate variants allowed | ✅ DB + BE |
| **#9** | Admin post-completion qty edit with audit trail (`stock_request_qty_audits`) | ✅ DB + BE + FE |
| Lock toggle | `request_lock_enabled` setting — when OFF, ignore the cutoff | ✅ BE + FE |
| Print redesign | A4 + thermal both use a centred brand header, 2-col dense items, money/quantity strip with inlined timestamp | ✅ |
| Brand gold gradient | Sitewide replacement of solid-black primary surfaces with `GOLD_GRADIENT` | ✅ |
| Accounts dashboard (Phase 3) | Admin `/admin/accounts` — date-ranged stock-movement value at MRP (default range: current IST month). KPI strip + by-shop / by-category / top-products tables + adjustments log + in-transit strip + CSV export per table. Anchored on `received_at` (Orders) / `accepted_at` (Returns); adjustments posted cash-basis on `edited_at`. New `DB/phase3/` folder; SPs are SELECT-only. Stale/unknown shop+category filters in the URL self-heal. (The trend chart, day/week/month grouping, and Godowns filter were dropped during UI simplification for the non-technical audience; the backend trend SP/endpoint remain but are unused.) | ✅ |

---

## Do not

- **Never auto-commit / push**. User runs `git add`/`commit`/`push` themselves unless they explicitly ask.
- **Match scope strictly**. When asked to change one element, only change that one. Don't extend "for consistency" to siblings that weren't mentioned.
- **Don't run `phaseN_init.sql` on a populated DB**. Init files are fresh-deploy only — they use plain `CREATE TABLE` (no `IF NOT EXISTS` everywhere). Use the matching migration script in `One shot scripts/` for existing deploys.
- **Don't write one-shot SQL files into `DB/phase1/` or `DB/phase2/`** — they belong in `DB/One shot scripts/` (gitignored). Canonical schema files only in the phase folders.
- **Don't create a duplicate category name as a sibling**. Names are case-insensitively unique per parent — DB rejects.
- **Don't bypass the SP layer** from the repo. Repository methods always call a `fn_*` function; never raw `INSERT/UPDATE` from .NET.
- **Don't add `containedPrimary` overrides via styleOverrides slot** in MUI theme — that slot doesn't fire in MUI v9. Use the `root` slot with an `ownerState` callback (already wired in `theme.ts`).

---

## Common tasks

### Add a new product field (e.g. `barcode`)

1. DB: `ALTER TABLE products ADD COLUMN barcode varchar(50);` (write as a one-shot migration under `DB/One shot scripts/`, also bake into `phase1_init.sql` for fresh deploys).
2. SPs: update `fn_product_list / get / create / update / create_bulk` to include the new column in `RETURNS TABLE` + `SELECT` + `INSERT`.
3. BE entity: `Product.cs` — add `Barcode` property.
4. BE DTO: `ProductDto.cs` — add `Barcode` to the record.
5. BE service: pass through in mappers; add validation rule if needed.
6. FE types: `front-end/src/api/products/types.ts` — add `barcode: string | null`.
7. FE form: `Products.tsx` ProductFormDialog — add a TextField.
8. FE list: optional new column in the DataGrid.
9. FE Excel import: add `barcode` to the parser's expected headers + the RawRow record.

### Wipe just catalogue + requests (keep users / shops / godowns)

```
DB/One shot scripts/phase2_reset_catalogue_and_requests.sql
```

### Wipe everything transactional (categories preserved)

```
DB/One shot scripts/phase1_reset_data.sql
```

### Stress-test the prints

```
DB/One shot scripts/phase2_seed_max_catalogue.sql
```

→ 158 products, 5 requests × 150 line items each.

---

## Quick references

**Auto-seeded admin**: `admin / admin123` (first BE boot if `Seed:AdminPassword` is set).

**JWT**: `Bearer` header, 8-hour expiry by default. Token stored client-side in `localStorage`.

**Print preview tip**: Chrome's "Save as PDF" honours the `@page` size on the thermal print (`size: 80mm auto`). Real thermal printers print one continuous strip.

**Build outputs and `node_modules`** are gitignored — don't commit them.

---

Last updated: 01-Jun-2026.
