# Design: fix-accounts-dashboard-feedback

## Context

The Phase 3 Accounts dashboard (`/admin/accounts`) shipped in
`add-accounts-dashboard` and went through its first client review. This change
implements the feedback round: two correctness bugs, a new "Requested" measure,
and a batch of FE-only polish. The dashboard is read-only; all data comes from
`fn_accounts_*` SELECT-only SPs in `DB/phase3/phase3_procedures.sql`, surfaced
through `AccountsController → AccountsService → AccountsRepository` and the
TanStack Query hooks in `front-end/src/hooks/useAccounts.ts`.

Current state relevant to this change:

- `fn_accounts_summary` computes `net_amount = dispatched − returns`;
  `adjustments_amount` is returned but never folded into net. Same shape in
  `fn_accounts_by_shop`.
- `AccountsFilterBar.tsx` has five private IST date helpers that double-shift
  the timezone (`new Date(now.toLocaleString(…IST))` parses IST wall-clock as
  machine-local, then formats to IST again) — "Today" lands on tomorrow when
  the machine TZ is west of IST. The correct single-conversion pattern already
  exists in `AdminAccounts.istFirstOfThisMonth` (formatToParts) and
  `DateRangeFilter.istToday`.
- The accounts filter card is an always-open white MUI Card; the stock-request
  list pages use the collapsible `FilterPanel`/`FilterBar` (cream `#FFFBE6`,
  gold pills) from `components/FilterBar.tsx`.

## Goals / Non-Goals

**Goals:**

- Net reconciles: KPI Net = Σ(by-shop Net) = Dispatched − Returns + Adjustments.
- "Requested (at MRP)" measure visible at the KPI level and per shop, computed
  over the same received-in-range Orders the page already counts.
- Date presets produce correct IST dates regardless of machine timezone.
- Accounts filter UX matches the stock-request pages (collapsible, pills,
  cream background) and drops the Categories control.
- Grid polish: no column menus, horizontal scroll over squish, alphabetic
  default sorts, no Δ symbols, name-not-code chips, gold active-preset.
- Date pickers display `DD/MM/YYYY` app-wide.

**Non-Goals:**

- No change to by-category / top-products **amounts** (they stay signed
  Dispatched − Returns; adjustments are not attributed to categories in v1 —
  see Risks).
- No change to the trend SP/endpoint (still unused after the UI simplification).
- No change to table **timestamp** rendering ("26 May 2026, 2.30pm" stays).
- No removal of the backend `cat_ids` parameter — only the UI control goes.
- No pagination/server-side sort changes on the grids.

## Decisions

### D1 — Requested amount: same `finalised` CTE, Order rows only

`requested_amount = Σ(it.requested_qty × it.unit_price)` joined to the existing
`finalised` CTE filtered to `request_type = 'Order'`. Same `received_at` anchor,
same shop/inventory/category filters — so Requested vs Dispatched is an
apples-to-apples fulfilment-gap comparison on identical request sets.

*Alternative considered:* anchor on `submitted_at` over all Orders placed in
range — rejected: numbers would not reconcile with the rest of the page and
would double-count across periods when an order spans month-end.

Returns are excluded from the Requested measure entirely (a Return's
`requested_qty` is the qty the shop asked to send back — not demand).

### D2 — Live-truth amounts: Dispatched/Returns from line items, Net = Dispatched − Returns

**Discovery during implementation:** `stock_requests.total_amount` is frozen at
create/update as Σ `requested_qty × unit_price` — never recomputed at dispatch,
receive, or qty edit. So the v1 KPI "Dispatched" actually showed the *requested*
value, and a qty edit moved the Adjustments card but not Net (the client's
bug #2). Meanwhile `fn_accounts_by_category` / `fn_accounts_top_products`
already compute live item-level amounts — the KPI and by-shop were the odd
ones out.

**Decision (clarified with client): live-truth model.**

- `dispatched_amount` = Σ `COALESCE(it.dispatched_qty, it.requested_qty) ×
  it.unit_price` over Order items (live — reflects post-completion edits
  immediately).
- `returns_amount` = same expression over Return items (`dispatched_qty` is
  reused as accepted-qty on Returns).
- `net_amount = dispatched_amount − returns_amount`. Adjustments are **not**
  added — a qty edit already moves the live Dispatched (adding them would
  double-count). There is no Adjustments KPI card (client follow-up: a
  peer-level card read as money to add); the adjustments total lives on the
  Adjustments log header ("N edits · net effect ₹X — already included in the
  totals above"), with the per-shop split in the by-shop column.
- Both `fn_accounts_summary` and `fn_accounts_by_shop` compute this in SQL;
  the FE renders `netAmount` verbatim.

*Alternative considered:* frozen ledger (dispatch-time value reconstructed by
subtracting audit deltas; Net = Disp − Ret + Adj posted on `edited_at`) —
rejected with the client: much more complex SQL, and the dashboard would
disagree with the request detail page after an edit. Trade-off accepted:
re-viewing a past month after a later edit shows corrected, not frozen,
numbers.

### D3 — By-shop new columns

`fn_accounts_by_shop` adds four columns (then 5-file chain: entity → DTO →
mapper → FE types → grid + CSV export header list):

| Column | Source |
|---|---|
| `requested_qty` | Σ `it.requested_qty` over Order items of finalised Orders |
| `requested_amount` | Σ `it.requested_qty × it.unit_price` over the same |
| `returned_qty` | Σ `COALESCE(it.dispatched_qty, it.requested_qty)` over Return items (the column is reused as accepted-qty on Returns, per the Phase 2 convention) |
| `adjustments_amount` | per-shop informational aggregate — qty audits anchored on `edited_at` in range, joined audit → request → shop, amount = `(new_qty − old_qty) × it.unit_price`; NOT folded into net (see D2) |

`dispatched_amount` and `returns_amount` switch from `r.total_amount` to the
live item-level sums (D2), making them consistent with the qty columns and
with by-category / top-products.

Column order in the grid: Code, Shop, Orders, Returns, Req Qty, Disp Qty,
Returned Qty, Requested (MRP), Dispatched (MRP), Returns (MRP),
Adjustments (MRP), Net (MRP). All numeric columns get fixed `width` (no flex)
so the DataGrid overflows into its built-in horizontal scrollbar instead of
squishing; only Shop name keeps `flex` with a `minWidth`.

### D4 — IST date helpers: one shared util, calendar-parts arithmetic

Create `front-end/src/utils/istDate.ts` exporting `istToday()`,
`istDate(offsetDays)`, `istMondayOfThisWeek()`, `istFirstOfThisMonth()`,
`istFirstOfPrevMonth()`, `istLastOfPrevMonth()`.

Implementation pattern: extract the IST calendar parts once via
`Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', … }).formatToParts`,
then do all arithmetic in **UTC space** (`Date.UTC(y, m−1, d + offset)` +
`toISOString().slice(0, 10)`). UTC-space arithmetic is timezone-free, so no
second conversion can sneak in. `Date.UTC` normalises out-of-range day/month
values, which gives first/last-of-month and Monday-of-week for free.

`DateRangeFilter.istToday` is already correct — it re-exports from the new
util so there is exactly one implementation. `AdminAccounts.istFirstOfThisMonth`
and the five broken helpers in `AccountsFilterBar` are deleted in favour of the
util. (Keep the `istToday` re-export from `DateRangeFilter` so existing imports
elsewhere don't break.)

### D5 — Active preset highlight: derived, not stored

A preset is "active" when `p.from() === filters.from && p.to() === filters.to`.
Active button renders `variant="contained"` (the theme's ownerState callback
already paints contained-primary with the gold gradient — do **not** add a
`containedPrimary` styleOverride, per CLAUDE.md); inactive stays `outlined`.
No new URL state — manual date edits naturally un-highlight every preset, and
a shared link highlights correctly on load.

### D6 — FilterPanel wiring: AdminAccounts owns `open`, pills mirror stock-request pages

`AdminAccounts` wraps `AccountsFilterBar` in the existing
`FilterPanel`/`FilterBar` components, collapsed by default (`useState(false)`,
transient — not URL state, same as AdminRequests). Pills:

- Date range via the existing `dateRangeLabel(from, to)` helper ("Today",
  "1 Jun – 4 Jun", …). Not removable (the range always applies — no ✕).
- One pill per selected shop, labelled with the shop **name**, ✕ removes that id.

`AccountsFilterBar` becomes the *contents* (preset row + two DatePickers + the
Shops autocomplete in `FilterRow`s) and drops its own Card chrome — the cream
background comes from `FilterBar`. The Categories autocomplete is deleted;
the URL self-healing for `categoryIds` in `AdminAccounts` stays (old links).

### D7 — DD/MM/YYYY pickers app-wide: standardise on MUI X DatePicker

- `AccountsFilterBar`'s two DatePickers: `format="DD/MM/YYYY"` (slashes).
- `DateRangeFilter` (stock-request pages) currently uses native
  `<input type="date">`, whose display format is browser-locale-controlled and
  cannot be forced. Convert its two fields to MUI X `DatePicker`
  (`size="small"`, `format="DD/MM/YYYY"`, same 150px width, same min/max
  cross-constraints, emitting the same `YYYY-MM-DD` strings). This is the only
  other date picker in the app, so this completes "app-wide".

*Alternative considered:* keep native inputs (en-IN browsers usually show
dd-mm-yyyy) — rejected: format then depends on each user's OS locale, which is
exactly the class of bug this feedback round is about.

### D8 — Grid polish is per-grid props, no new abstractions

`disableColumnMenu` on all four DataGrids of the page (by-shop, by-category,
top-products, adjustments). Default sorts change in `initialState` only:
by-shop → `shopName asc`, by-category → `categoryPath asc` (top-products and
adjustments keep their current defaults). Adjustments headers: `Δ Qty` →
`Qty`, `Δ Amount (MRP)` → `Amount (MRP)`. Request-code link rendering stays as
the `MuiLink + stopPropagation` pattern already used in the adjustments log;
the by-shop row-click drilldown to `/admin/requests` is unchanged.

## Risks / Trade-offs

- **[Past periods are not frozen]** — a June qty edit on a May order changes
  May's numbers when re-viewed (live-truth model, clarified with client).
  → The Adjustments log still shows every edit with its timestamp, so any
  retroactive movement is explainable.
- **[`requested_qty × unit_price` assumes unit_price is the snapshot price]**
  — true by Phase 2 design (unit_price is frozen at submit). No action.
- **[Per-shop adjustments join can pick up audits on Returns]** — qty audits
  reference any request type; the per-shop aggregate must use the same
  `edited_at`-anchored, request-joined logic as the summary CTE so the two
  totals match. Mitigation: derive both from the same CTE shape; the spec pins
  Σ(by-shop adjustments) = KPI adjustments.
- **[DateRangeFilter → DatePicker conversion touches every list page]** —
  visual regression risk on Shop/Inventory/Admin request lists. Mitigation:
  keep emitted value format (`YYYY-MM-DD`/`''`) and width identical; only the
  input widget changes. Verify each list page renders and filters after.
- **[12-column by-shop grid on small screens]** — horizontal scrollbar is the
  designed behaviour (clarified with client); fixed widths make it predictable.
- **[SP re-run on live DB]** — `CREATE OR REPLACE` + `DROP FUNCTION IF EXISTS`
  for signature changes is idempotent and SELECT-only; no table DDL, so no
  migration script is needed. Rollback = re-run the previous file version.

## Migration Plan

1. Re-run `DB/phase3/phase3_procedures.sql` on the dev DB (idempotent;
   signature changes use `DROP FUNCTION IF EXISTS` first, per the existing
   file convention).
2. Deploy BE (additive DTO fields — old FE keeps working during rollout).
3. Deploy FE.

No data migration; no init-file change (no new tables).

## Open Questions

- None — all 15 feedback items were clarified with the client before this
  change was drafted (requested-amount anchoring, net formula scope, picker
  format scope, link/symbol semantics).
