## ADDED Requirements

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

The dashboard SHALL render a KPI strip with exactly four cards:

1. **Dispatched** — sum of `total_amount` over all Orders in range (Received, in date filter).
2. **Returns** — sum of `total_amount` over all Returns in range (Accepted, in date filter).
3. **Net** — Dispatched minus Returns.
4. **Adjustments** — sum of `(new_qty − old_qty) * unit_price` over all qty-audit rows whose `edited_at` falls in the IST date range, joined to the line item for `unit_price`. NULL `old_qty` or `new_qty` is treated as 0.

Each card SHALL display the rupee value and a secondary metric (request count for Dispatched/Returns, distinct-shop count for Net, edit count for Adjustments). Currency labels SHALL read "MRP value" or include the disambiguation "(at MRP)" — never bare "₹" without context.

#### Scenario: Net computation

- **GIVEN** Dispatched = ₹1,42,300 and Returns = ₹8,420 in the selected range
- **WHEN** the dashboard renders
- **THEN** the Net card SHALL display ₹1,33,880

#### Scenario: Adjustments use historical unit_price

- **GIVEN** a qty audit row with `old_qty = 10, new_qty = 8`, edited 2026-05-29, on an item whose `unit_price` was ₹120 when the Order was submitted, even though the product's current MRP is ₹150
- **WHEN** that audit row falls in the selected range
- **THEN** the Adjustments contribution SHALL be `(8 − 10) * 120 = −₹240`, not `(8 − 10) * 150`

#### Scenario: All KPIs zero on empty range

- **WHEN** the selected range has no Received Orders, no Accepted Returns, and no qty-audit edits
- **THEN** all four KPI cards SHALL display "₹0" and their secondary metrics SHALL display "0"

### Requirement: Filters

The dashboard SHALL support filtering by:

- **Date range** (`from`, `to`) — required, IST calendar dates inclusive.
- **Shops** — multi-select shop ids; empty = all shops.
- **Categories** — multi-select category ids; each selected id SHALL be expanded to include all descendant category ids via the existing `fn_category_tree` walk before filtering products.

A shop or category id in the URL that matches no current record (e.g. after a re-seed, or a stale shared link) SHALL be ignored — treated as no filter and stripped from the URL — rather than silently filtering the page to an all-zero result.

All filters SHALL be reflected in the URL as query params and SHALL survive a page refresh.

#### Scenario: Category filter includes descendants

- **GIVEN** category "Biscuits" has children "Big Biscuit" and "Small Biscuit", with product P-001 in "Big Biscuit"
- **WHEN** the category filter is set to "Biscuits" only
- **THEN** rows containing product P-001 SHALL be included in all breakdowns

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
- Dispatched quantity (sum of `dispatched_qty` over Order line items, falling back to `requested_qty` when `dispatched_qty IS NULL`)
- Dispatched MRP value
- Returns MRP value
- Net MRP value (Dispatched − Returns)

Rows SHALL be sorted by Net descending by default. Clicking a row SHALL navigate to `/admin/requests` with the shop and date range pre-applied via URL params.

#### Scenario: Sort default

- **WHEN** the shop breakdown loads with multiple shops
- **THEN** rows SHALL appear in descending Net order

#### Scenario: Drilldown link

- **WHEN** the user clicks a row for shop `SHP012` in a range of `2026-05-25 → 2026-05-31`
- **THEN** the browser SHALL navigate to `/admin/requests?shop_id=<uuid>&from=2026-05-25&to=2026-05-31`

### Requirement: Category breakdown and top products

The dashboard SHALL provide a tabbed section with two views:

- **By category** — one row per leaf category referenced by the filtered requests, with category path (root > … > leaf), quantity, MRP value. Rows summing to root-level totals are not required for v1.
- **Top products** — top N products by MRP value in the filtered range, with N selectable from {10, 25, 50}, default 10.

#### Scenario: Top products honours N

- **GIVEN** 80 distinct products contributed in the range
- **WHEN** the user selects N=25
- **THEN** the table SHALL show exactly 25 rows, sorted by MRP value descending

#### Scenario: Category path uses ` > ` separator

- **GIVEN** a leaf category "Big Biscuit" under root "Snacks > Sweet"
- **WHEN** that category appears in the breakdown
- **THEN** the path column SHALL display "Snacks > Sweet > Big Biscuit"

### Requirement: Adjustments log

The dashboard SHALL render a table of `stock_request_qty_audits` rows whose `edited_at` falls in the IST date range, ordered by `edited_at` descending. Columns:

- Edited at (IST, formatted `dd-MMM-yyyy HH:mm`)
- Request code (linked to its detail page)
- Shop name
- Product name + pack-size
- Old qty → New qty
- Δ qty
- Δ ₹ (= `(new_qty − old_qty) * unit_price`, NULL qty treated as 0)
- Reason (free text, may be empty)
- Edited by (user full name)

#### Scenario: Audit row in range

- **GIVEN** a qty audit edited 2026-05-28 14:32 IST
- **WHEN** the range is `2026-05-25 → 2026-05-31`
- **THEN** that audit SHALL appear in the log

#### Scenario: Δ ₹ negative on qty reduction

- **GIVEN** old_qty=10, new_qty=8, unit_price=120
- **WHEN** the audit row renders
- **THEN** Δ qty SHALL display `−2` and Δ ₹ SHALL display `−₹240`

#### Scenario: NULL old_qty handled

- **GIVEN** an audit row with `old_qty IS NULL, new_qty=5, unit_price=100`
- **WHEN** the audit row renders
- **THEN** Δ qty SHALL display `+5` and Δ ₹ SHALL display `+₹500`

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
