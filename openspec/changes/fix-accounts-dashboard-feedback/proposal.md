# Proposal: fix-accounts-dashboard-feedback

## Why

The Phase 3 Accounts dashboard went through its first client review (non-technical
audience). The feedback round surfaced two correctness bugs — the Net figure
silently excludes Adjustments, and the "Today" preset lands on tomorrow's date
when the machine timezone is west of IST — plus a batch of usability gaps:
missing "requested" visibility (the gap between what shops asked for and what
was dispatched), inconsistent filter UX vs the stock-request screens, confusing
DataGrid column menus, and Δ/code-centric labels that mean nothing to the
business users reading the page.

## What Changes

**Correctness (DB + BE + FE):**

- Net SHALL be `Dispatched − Returns + Adjustments` — in the summary KPI **and**
  the by-shop breakdown — so the grid column reconciles with the top card.
  (Today adjustments are computed but never added to net.)
- Fix the double-timezone-shift bug in `AccountsFilterBar`'s five date-preset
  helpers (`istDate`, `istMondayOfThisWeek`, `istFirstOfThisMonth`,
  `istFirstOfPrevMonth`, `istLastOfPrevMonth`): they parse an IST wall-clock
  string as machine-local time and then convert to IST again. Replace with the
  `formatToParts` pattern already used in `AdminAccounts.tsx`.

**New "Requested" measure (DB + BE + FE):**

- Summary KPI strip gains a **Requested (at MRP)** card — Σ `requested_qty ×
  unit_price` over the *same* received-in-range Orders the rest of the page
  counts (same `received_at` anchor) — placed first; **Net moves last**.
  Card order: Requested → Dispatched → Returns → Adjustments → Net.
- By-shop breakdown gains four columns: Requested Qty, Returned Qty,
  Requested (MRP), Adjustments (MRP).

**Filter bar rework (FE only):**

- Wrap the Accounts filters in the existing collapsible `FilterPanel` /
  `FilterBar` components (same pattern as the stock-request list pages):
  collapsed by default, gold active-filter pills, cream `#FFFBE6` background
  instead of the current always-open white card.
- Remove the Categories autocomplete from the filter bar (the backend
  `cat_ids` param stays; only the UI control goes).
- Shop filter chips show the shop **name**, not the code.
- The active date-preset button (Today / Yesterday / This week / …) is
  highlighted with the gold gradient when the current range matches it.

**Grid polish (FE only):**

- `disableColumnMenu` on all Accounts DataGrids — sorting stays via header
  click with the sort arrow; the three-dot menu goes.
- Fixed/min column widths so the by-shop grid (now 12 columns) scrolls
  horizontally instead of squishing.
- By-shop default sort: shop name ascending (was Net descending).
- By-category default sort: category path ascending (was Amount descending).
- Adjustments-log headers drop the Δ symbol: "Qty" / "Amount (MRP)".
- Request codes are clickable links to the request detail page everywhere
  they appear on this screen (today only the Adjustments log links).

**App-wide (FE only):**

- Date **pickers** display `DD/MM/YYYY` (slashes) app-wide. Rendered
  timestamps in tables keep the existing "26 May 2026, 2.30pm" style.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `accounts-reporting`: KPI strip becomes five cards with a new Requested
  measure and a new Net formula (includes Adjustments); shop breakdown gains
  requested/returned/adjustments columns and changes default sort; filters
  lose the Categories control and gain the collapsible panel + preset
  highlight behavior; adjustments log relabels Δ columns; date presets must
  produce correct IST dates on any machine timezone. (Capability is defined
  in the in-flight `add-accounts-dashboard` change — not yet archived to
  `openspec/specs/` — so this change carries a delta spec against it.)

## Impact

- **DB** — `DB/phase3/phase3_procedures.sql` (canonical, `CREATE OR REPLACE`,
  re-runnable): `fn_accounts_summary` (+`requested_amount`, net formula),
  `fn_accounts_by_shop` (+4 columns, net formula). SELECT-only stays true.
- **Backend** — the standard 5-file chain per changed SP:
  `AccountsSummary` / `AccountsShopRow` entities, `AccountsDtos.cs`,
  `AccountsService` mappers, CSV export column lists for by-shop.
- **Frontend** — `api/accounts/types.ts`, `KpiStrip`, `ShopBreakdownTable`,
  `CategoryAndProductsTable`, `AdjustmentsLogTable`, `AccountsFilterBar`
  (rework), `AdminAccounts` (FilterPanel wiring); shared `DateRangeFilter` /
  any `DatePicker` `format` props for the DD/MM/YYYY picker change.
- **No breaking API changes** — new response fields are additive; existing
  query params unchanged.
