# accounts-reporting Specification

## Purpose

Read-only Phase 3 Accounts dashboard for Admin users: date-ranged stock-movement
value at MRP with per-shop / per-category / top-product breakdowns, a qty-edit
adjustments log, an in-transit strip, and CSV exports. Assembled from the
`add-accounts-dashboard` change (v1) plus the `fix-accounts-dashboard-feedback`
client-review round (live Net model, Requested measure, filter/grid UX polish).

## Requirements

### Requirement: Admin role gating

The Accounts dashboard and all of its endpoints SHALL be accessible only to authenticated users with the `Admin` role. ShopUser and Inventory roles SHALL receive HTTP 403 when calling any `/api/accounts/*` endpoint and SHALL NOT see the Accounts entry in the sidebar.

#### Scenario: Admin reaches the page

- **WHEN** an authenticated Admin navigates to `/admin/accounts`
- **THEN** the dashboard renders with default-range data loaded

#### Scenario: ShopUser blocked

- **WHEN** an authenticated ShopUser sends `GET /api/accounts/summary`
- **THEN** the API SHALL respond with HTTP 403 Forbidden

#### Scenario: Inventory blocked

- **WHEN** an authenticated Inventory user sends `GET /api/accounts/by-shop`
- **THEN** the API SHALL respond with HTTP 403 Forbidden

#### Scenario: Sidebar visibility

- **WHEN** a ShopUser or Inventory user loads the app
- **THEN** the sidebar SHALL NOT include the Accounts entry

### Requirement: Date range anchoring

Every row contributing to the main KPI, trend, and breakdown sections SHALL be anchored to a single calendar date in `Asia/Kolkata` (IST), computed as:

- For `request_type = 'Order'` and `status = 'Received'`: the IST calendar date of `received_at`.
- For `request_type = 'Return'` and `status = 'Accepted'`: the IST calendar date of `accepted_at`.

Requests in any other status (Draft, Pending, Approved, Dispatched, Cancelled, Rejected) SHALL NOT contribute to KPI / trend / breakdown numbers. Cancelled and Dispatched-not-yet-Received Orders are surfaced in the separate In-transit strip per its own requirement.

#### Scenario: IST midnight boundary, Order

- **GIVEN** an Order with `received_at = 2026-05-31 18:35:00 UTC` (which is 2026-06-01 00:05 IST)
- **WHEN** the dashboard's date filter is `from=2026-05-25, to=2026-05-31`
- **THEN** that Order SHALL NOT be included
- **WHEN** the date filter is `from=2026-06-01, to=2026-06-07`
- **THEN** that Order SHALL be included

#### Scenario: Return anchored on accepted_at

- **GIVEN** a Return with `submitted_at = 2026-05-20` and `accepted_at = 2026-05-30`
- **WHEN** the dashboard's date filter is `from=2026-05-25, to=2026-05-31`
- **THEN** that Return SHALL be included

#### Scenario: Non-final status excluded

- **GIVEN** an Order with `status = 'Dispatched'` and `dispatched_at = 2026-05-28`
- **WHEN** the dashboard's date filter is `from=2026-05-25, to=2026-05-31`
- **THEN** that Order SHALL NOT contribute to KPI, trend, or breakdown numbers

### Requirement: KPI strip

The dashboard SHALL render a KPI strip with exactly four cards, in this order:

1. **Requested** — sum of `requested_qty * unit_price` over the line items of
   all Orders in range (Received, in date filter). Same `received_at` anchor
   and shop/category filters as Dispatched, so the two are directly comparable.
2. **Dispatched** — sum of `COALESCE(dispatched_qty, requested_qty) * unit_price` over the line items of all Orders in range (Received, in date filter). This is the live current value: a post-completion qty edit SHALL be reflected immediately.
3. **Returns** — sum of `COALESCE(dispatched_qty, requested_qty) * unit_price` over the line items of all Returns in range (Accepted, in date filter; `dispatched_qty` is reused as accepted-qty on Returns).
4. **Net** — Dispatched minus Returns.

The strip SHALL NOT include an Adjustments card: qty edits flow into the live Dispatched figure directly, so a peer-level Adjustments number reads as money to add and would double-count. The adjustments total is surfaced on the Adjustments log header instead (see that requirement).

Each card SHALL display the rupee value and a secondary metric (request count for Requested/Dispatched/Returns, distinct-shop count for Net). Currency labels SHALL read "MRP value" or include the disambiguation "(at MRP)" — never bare "₹" without context. The Net card SHALL carry the gold-gradient accent.

#### Scenario: Qty edit moves Dispatched and Net immediately

- **GIVEN** an Order received in range with one line item `dispatched_qty = 8, unit_price = 100` (Dispatched = ₹800)
- **WHEN** an admin edits that item's qty from 8 to 7
- **THEN** on the next dashboard load Dispatched SHALL display ₹700, Net SHALL move by −₹100, and the Adjustments log header total SHALL include the −₹100 edit

#### Scenario: Net computation

- **GIVEN** live Dispatched = ₹1,42,300 and live Returns = ₹8,420 in the selected range
- **WHEN** the dashboard renders
- **THEN** the Net card SHALL display ₹1,33,880 (= 1,42,300 − 8,420); Adjustments SHALL NOT be added on top

#### Scenario: Requested vs Dispatched on the same orders

- **GIVEN** a single Order received in range with one line item `requested_qty = 10, dispatched_qty = 8, unit_price = 100`
- **WHEN** the dashboard renders
- **THEN** the Requested card SHALL display ₹1,000 and the Dispatched card SHALL display ₹800

#### Scenario: Requested excludes Returns

- **GIVEN** the selected range contains one Accepted Return with `requested_qty = 5, unit_price = 100`and no Orders
- **WHEN** the dashboard renders
- **THEN** the Requested card SHALL display ₹0

#### Scenario: Card order

- **WHEN** the KPI strip renders
- **THEN** the cards SHALL appear left-to-right as Requested, Dispatched, Returns, Net — with no Adjustments card

#### Scenario: All KPIs zero on empty range

- **WHEN** the selected range has no Received Orders, no Accepted Returns, and no qty-audit edits
- **THEN** all four KPI cards SHALL display "₹0" and their secondary metrics SHALL display "0"

### Requirement: Filters

The dashboard SHALL support filtering by:

- **Date range** (`from`, `to`) — required, IST calendar dates inclusive.
- **Shops** — multi-select shop ids; empty = all shops.

The filter controls SHALL be presented in the same collapsible filter panel used by the stock-request list pages: collapsed by default, with a "Filter" toggle button and active-filter summary pills (gold gradient) while collapsed, expanding to reveal the full controls on a cream `#FFFBE6` surface. The pills SHALL show the date-range label and one pill per selected shop, labelled with the shop **name** (not code); each shop pill's ✕ SHALL remove that shop from the filter. Selected shops inside the expanded Shops control SHALL likewise display shop names.

The Categories filter control SHALL NOT be rendered. The backend SHALL continue to accept `cat_ids` (existing links keep working), and a category id in the URL SHALL still be applied to the data and self-healed when stale.

A shop or category id in the URL that matches no current record (e.g. after a re-seed, or a stale shared link) SHALL be ignored — treated as no filter and stripped from the URL — rather than silently filtering the page to an all-zero result.

All filters SHALL be reflected in the URL as query params and SHALL survive a page refresh.

#### Scenario: Collapsed by default with pills

- **WHEN** the user navigates to `/admin/accounts`
- **THEN** the filter panel SHALL be collapsed and SHALL show a date-range pill (e.g. "1 Jun – 4 Jun")

#### Scenario: Shop pill shows name and removes on ✕

- **GIVEN** shop `SHP012` named "Kovilpatti Main" is selected
- **WHEN** the panel is collapsed
- **THEN** a pill labelled "Kovilpatti Main" SHALL be shown, and clicking its ✕ SHALL remove that shop from the filter

#### Scenario: No Categories control

- **WHEN** the filter panel is expanded
- **THEN** no Categories picker SHALL be present

#### Scenario: URL state survives refresh

- **GIVEN** the user has set `from=2026-05-25, to=2026-05-31, shop_ids=<uuid-a>`
- **WHEN** the user refreshes the page
- **THEN** the page SHALL re-render with the same filters applied

#### Scenario: Default range on first load

- **WHEN** the user navigates to `/admin/accounts` with no query params
- **THEN** the page SHALL default to `from = first day of the current IST month`, `to = today IST`

#### Scenario: Stale/unknown filter id is ignored

- **GIVEN** the URL carries a shop or category id that matches no current record (e.g. after data was re-seeded with new ids, or an old shared link)
- **WHEN** the page loads
- **THEN** the unknown id SHALL be ignored (treated as no filter) and removed from the URL, rather than producing an all-zero result

### Requirement: Shop breakdown table

The dashboard SHALL render a per-shop breakdown table with columns:

- Shop code + name
- Order request count
- Return request count
- Requested quantity (sum of `requested_qty` over Order line items)
- Dispatched quantity (sum of `dispatched_qty` over Order line items, falling back to `requested_qty` when `dispatched_qty IS NULL`)
- Returned quantity (sum of `dispatched_qty` — reused as accepted-qty — over Return line items, falling back to `requested_qty` when NULL)
- Requested MRP value (sum of `requested_qty * unit_price` over Order line items)
- Dispatched MRP value (sum of `COALESCE(dispatched_qty, requested_qty) * unit_price` over Order line items — live)
- Returns MRP value (same expression over Return line items — live)
- Adjustments MRP value (sum of `(new_qty − old_qty) * unit_price` over qty audits whose `edited_at` falls in range, attributed to the shop of the audited request; informational — NOT folded into Net)
- Net MRP value (Dispatched − Returns)

The sum of the per-shop Adjustments column over all shops SHALL equal the KPI Adjustments value for the same filters, and the sum of per-shop Net SHALL equal the KPI Net.

Rows SHALL be sorted by shop name ascending by default. Numeric columns SHALL have fixed widths so that when the table is narrower than the sum of column widths, a horizontal scrollbar appears rather than columns shrinking. Clicking a row SHALL navigate to `/admin/requests` with the shop and date range pre-applied via URL params.

#### Scenario: Sort default

- **WHEN** the shop breakdown loads with multiple shops
- **THEN** rows SHALL appear in ascending alphabetical order of shop name

#### Scenario: Per-shop net reconciles with KPI

- **GIVEN** any filter combination
- **WHEN** the by-shop rows and the KPI strip are computed
- **THEN** Σ(row Net) SHALL equal the KPI Net and Σ(row Adjustments) SHALL equal the KPI Adjustments

#### Scenario: Narrow viewport scrolls horizontally

- **WHEN** the viewport is narrower than the sum of the table's column widths
- **THEN** the table SHALL present a horizontal scrollbar and column content SHALL NOT be truncated by shrinking

#### Scenario: Drilldown link

- **WHEN** the user clicks a row for shop `SHP012` in a range of `2026-05-25 → 2026-05-31`
- **THEN** the browser SHALL navigate to `/admin/requests?shop_id=<uuid>&from=2026-05-25&to=2026-05-31`

### Requirement: Category breakdown and top products

The dashboard SHALL provide a tabbed section with two views:

- **By category** — one row per leaf category referenced by the filtered requests, with category path (root > … > leaf), quantity, MRP value. Rows SHALL be sorted by category path ascending by default. Rows summing to root-level totals are not required for v1.
- **Top products** — top N products by MRP value in the filtered range, with N selectable from {10, 25, 50}, default 10.

#### Scenario: Category sort default

- **WHEN** the By category tab loads with multiple categories
- **THEN** rows SHALL appear in ascending alphabetical order of category path

#### Scenario: Top products honours N

- **GIVEN** 80 distinct products contributed in the range
- **WHEN** the user selects N=25
- **THEN** the table SHALL show exactly 25 rows, sorted by MRP value descending

#### Scenario: Category path uses ` > ` separator

- **GIVEN** a leaf category "Big Biscuit" under root "Snacks > Sweet"
- **WHEN** that category appears in the breakdown
- **THEN** the path column SHALL display "Snacks > Sweet > Big Biscuit"

### Requirement: Adjustments log

The dashboard SHALL render a table of `stock_request_qty_audits` rows whose `edited_at` falls in the IST date range, ordered by `edited_at` descending.

The table header SHALL display the period's adjustments total — edit count and net rupee effect — with wording that makes clear the effect is already included in the page totals (e.g. "871 edits · net effect ₹9,532 — already included in the totals above"). This header is the canonical home of the adjustments total; there is no Adjustments KPI card.

Columns:

- Edited at (IST)
- Request code (linked to its detail page)
- Shop name
- Product name + pack-size
- Old qty → New qty
- Qty (the qty delta; header SHALL read "Qty" without a Δ symbol)
- Amount (MRP) (= `(new_qty − old_qty) * unit_price`, NULL qty treated as 0; header SHALL read "Amount (MRP)" without a Δ symbol)
- Reason (free text, may be empty)
- Edited by (user full name)

Request codes SHALL render as clickable links to the request detail page wherever they appear on the Accounts screen.

#### Scenario: Header shows the adjustments total

- **GIVEN** 871 qty edits totalling ₹9,532 fall in the selected range
- **WHEN** the adjustments log renders
- **THEN** its header SHALL display the count (871) and the net effect (₹9,532) with the "already included in the totals above" wording

#### Scenario: No delta symbols in headers

- **WHEN** the adjustments log renders
- **THEN** the qty-delta column header SHALL be "Qty" and the amount-delta column header SHALL be "Amount (MRP)" — neither SHALL contain "Δ"

#### Scenario: Request code links to detail

- **GIVEN** an audit row for request `REQ0042`
- **WHEN** the user clicks the request code
- **THEN** the browser SHALL navigate to that request's detail page

#### Scenario: Audit row in range

- **GIVEN** a qty audit edited 2026-05-28 14:32 IST
- **WHEN** the range is `2026-05-25 → 2026-05-31`
- **THEN** that audit SHALL appear in the log

#### Scenario: Amount negative on qty reduction

- **GIVEN** old_qty=10, new_qty=8, unit_price=120
- **WHEN** the audit row renders
- **THEN** the qty column SHALL display `−2` and the amount column SHALL display `−₹240`

#### Scenario: NULL old_qty handled

- **GIVEN** an audit row with `old_qty IS NULL, new_qty=5, unit_price=100`
- **WHEN** the audit row renders
- **THEN** the qty column SHALL display `+5` and the amount column SHALL display `+₹500`

### Requirement: In-transit strip

The dashboard SHALL render an in-transit strip showing the count and total `total_amount` of all Orders with `status = 'Dispatched'` and `is_deleted = false`. The strip SHALL be independent of the selected date range. The strip SHALL also display the age (in days) of the oldest dispatched-not-received Order in this set.

#### Scenario: In-transit visible regardless of date filter

- **GIVEN** an Order dispatched 2026-05-15 still not received
- **WHEN** the date filter is `from=2026-05-25, to=2026-05-31`
- **THEN** that Order SHALL still contribute to the in-transit strip

#### Scenario: No in-transit Orders

- **WHEN** zero Orders are in `Dispatched` status
- **THEN** the strip SHALL render with "₹0", count "0", and SHALL NOT display an age

### Requirement: CSV export endpoints

The system SHALL expose one CSV export endpoint per breakdown table:

- `GET /api/accounts/export/by-shop`
- `GET /api/accounts/export/by-category`
- `GET /api/accounts/export/top-products`
- `GET /api/accounts/export/adjustments`

Each SHALL accept the same query params as its on-screen counterpart (`from`, `to`, `shop_ids`, `inv_ids`, `cat_ids`, plus the N param on top-products), run the same SP, and stream a UTF-8 CSV response with:

- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename=accounts-<table>_<from>_to_<to>.csv`
- A UTF-8 BOM (`\xEF\xBB\xBF`) as the first bytes
- A header row matching the on-screen column labels
- One data row per displayed row, in the same default sort order as the on-screen table
- Timestamps formatted as ISO 8601 (UTC) in one column and display string (IST) in another, when applicable

#### Scenario: CSV starts with BOM

- **WHEN** the user calls `GET /api/accounts/export/by-shop?from=…&to=…`
- **THEN** the response body SHALL begin with the bytes `EF BB BF`

#### Scenario: Filename format

- **WHEN** the user calls `GET /api/accounts/export/adjustments?from=2026-05-25&to=2026-05-31`
- **THEN** the response SHALL include header `Content-Disposition: attachment; filename=accounts-adjustments_2026-05-25_to_2026-05-31.csv`

#### Scenario: CSV row count matches on-screen

- **GIVEN** the on-screen shop breakdown shows 12 shops for a given filter
- **WHEN** the user exports with the same filters
- **THEN** the CSV SHALL contain exactly 12 data rows (plus 1 header row)

### Requirement: Read-only — no writes

No endpoint in `/api/accounts/*` SHALL modify any row in any table. All SPs SHALL be `SELECT`-only. The Accounts surface SHALL NOT trigger any audit, lock, or notification side effect.

#### Scenario: GET-only routes

- **WHEN** the OpenAPI surface for `AccountsController` is inspected
- **THEN** every route SHALL use HTTP `GET`; no `POST`, `PUT`, `PATCH`, or `DELETE` routes SHALL exist

#### Scenario: SP body is read-only

- **WHEN** any `fn_accounts_*` SP is examined
- **THEN** its body SHALL contain only `SELECT` / `WITH` / `RETURN QUERY` statements and SHALL NOT contain `INSERT`, `UPDATE`, `DELETE`, or `MERGE`

### Requirement: Validation

The system SHALL validate Accounts query parameters and reject invalid input with HTTP 400 and a structured error body:

- `from` and `to` MUST both be present and parseable as `yyyy-MM-dd`.
- `from` MUST be ≤ `to`.
- The span `to − from` MUST be ≤ 366 days.
- `shop_ids` (UUIDs) and `cat_ids` (integers) MUST be comma-separated when present; ids that match no current record are ignored, not rejected.
- Top-products `n` MUST be one of `10 | 25 | 50`; default is `10`.

#### Scenario: Missing date

- **WHEN** the user calls `GET /api/accounts/summary?from=2026-05-25` (no `to`)
- **THEN** the API SHALL respond with HTTP 400 and `errors.to` SHALL contain a "required" message

#### Scenario: Inverted range

- **WHEN** the user calls `GET /api/accounts/summary?from=2026-05-31&to=2026-05-25`
- **THEN** the API SHALL respond with HTTP 400 and `errors.range` SHALL describe the inversion

#### Scenario: Range too long

- **WHEN** the user calls `GET /api/accounts/summary?from=2025-01-01&to=2026-12-31`
- **THEN** the API SHALL respond with HTTP 400 indicating the 366-day cap

### Requirement: Date presets produce correct IST dates

The filter bar SHALL offer date presets (Today, Yesterday, This week, Last 30 days, This month, Last month). Every preset SHALL compute its from/to as IST calendar dates that are correct regardless of the machine's local timezone. Preset arithmetic SHALL be derived from a single IST wall-clock reading (no double timezone conversion).

#### Scenario: Today is today on a non-IST machine

- **GIVEN** the machine timezone is UTC and the current instant is 2026-06-04 15:00 UTC (= 2026-06-04 20:30 IST)
- **WHEN** the user clicks the "Today" preset
- **THEN** both from and to SHALL be `2026-06-04`

#### Scenario: Today across the IST midnight boundary

- **GIVEN** the machine timezone is UTC and the current instant is 2026-06-04 19:30 UTC (= 2026-06-05 01:00 IST)
- **WHEN** the user clicks the "Today" preset
- **THEN** both from and to SHALL be `2026-06-05`

#### Scenario: Last month spans the correct calendar month

- **GIVEN** the current IST date is 2026-06-04
- **WHEN** the user clicks "Last month"
- **THEN** from SHALL be `2026-05-01` and to SHALL be `2026-05-31`

### Requirement: Active date preset is highlighted

The preset button the user CLICKED SHALL be visually highlighted with the brand gold gradient (contained style), tracked explicitly (URL `preset` param) — never derived from range-matching alone, because two presets can produce the same range (e.g. This week == This month during the first week of a month) and both would highlight. At most one preset is ever highlighted. The highlight SHALL persist across refresh and panel collapse/expand, SHALL be cleared by a manual edit of either date, and SHALL NOT show when the tracked preset's computed range no longer equals the current from/to (e.g. a stale shared "Today" link opened the next day). Changing the shop filter SHALL NOT affect the highlight.

#### Scenario: Clicked preset highlights — even on range ties

- **GIVEN** the first week of a month, where "This week" and "This month" produce the same range
- **WHEN** the user clicks "This month"
- **THEN** only the "This month" button SHALL render with the gold-gradient contained style; "This week" SHALL stay outlined

#### Scenario: Manual edit clears highlight

- **GIVEN** "Today" is highlighted
- **WHEN** the user changes the From date to yesterday
- **THEN** no preset SHALL be highlighted

#### Scenario: Stale shared link does not mis-highlight

- **GIVEN** a link with `preset=today` and yesterday's dates
- **WHEN** it is opened the next day
- **THEN** no preset SHALL be highlighted (the tracked preset's range no longer matches)

### Requirement: Grid column menus disabled

Every DataGrid on the Accounts dashboard (by-shop, by-category, top-products, adjustments log) SHALL have the per-column three-dot menu disabled. Sorting SHALL remain available by clicking a sortable column header, with the sort-direction arrow displayed.

#### Scenario: No three-dot menu

- **WHEN** the user hovers any column header on any Accounts grid
- **THEN** no three-dot column menu button SHALL appear

#### Scenario: Header click sorts

- **WHEN** the user clicks the "Shop" column header on the by-shop grid
- **THEN** the rows SHALL re-sort by shop name and an ascending/descending arrow SHALL be shown in the header

### Requirement: Date pickers display DD/MM/YYYY

Every date picker in the application (the Accounts filter From/To pickers and the stock-request list DateRangeFilter) SHALL display and accept dates in `DD/MM/YYYY` format, independent of the browser or OS locale. Values SHALL continue to be stored and transmitted as `YYYY-MM-DD`. Rendered timestamps in tables (e.g. "26 May 2026, 2.30pm") are unchanged.

#### Scenario: Accounts pickers

- **GIVEN** the selected From date is 2026-06-04
- **WHEN** the Accounts filter panel renders
- **THEN** the From picker SHALL display `04/06/2026`

#### Scenario: Stock-request list pickers

- **GIVEN** a machine whose OS locale is en-US
- **WHEN** the Admin requests list date filter renders with From = 2026-06-04
- **THEN** the From picker SHALL display `04/06/2026` (not `06/04/2026`)

#### Scenario: URL/API value format unchanged

- **WHEN** the user picks 04/06/2026 in any date picker
- **THEN** the URL param and API query value SHALL be `2026-06-04`
