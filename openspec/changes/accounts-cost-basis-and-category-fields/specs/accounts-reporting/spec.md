# accounts-reporting — delta

## ADDED Requirements

### Requirement: Purchase-price snapshot on line items

Every `stock_request_items` row SHALL carry `purchase_price_snapshot numeric(10,2)`, populated at insert time from the product's current `purchase_price` by every SP that inserts line items (`fn_request_create`, `fn_request_update`, `fn_request_inventory_add_items`, `fn_request_create_return`). The value SHALL be NULL when the product has no purchase price at insert. All `fn_accounts_*` cost computations SHALL use `COALESCE(purchase_price_snapshot, 0)` — never the live `products.purchase_price` — so a later edit of a product's purchase price SHALL NOT change historical accounts figures. Pre-migration rows are backfilled best-effort from the product's current purchase price (documented approximate).

#### Scenario: Snapshot frozen at submit

- **GIVEN** a product with `purchase_price = 40` at submit time
- **WHEN** an Order line for it is created and the admin later changes the product's purchase price to 55
- **THEN** the line's `purchase_price_snapshot` SHALL remain 40 and accounts cost figures for that line SHALL be computed at 40

#### Scenario: Missing purchase price

- **GIVEN** a product with `purchase_price IS NULL`
- **WHEN** a line for it is inserted and accounts are computed
- **THEN** `purchase_price_snapshot` SHALL be NULL and the line SHALL contribute ₹0 to cost amounts

#### Scenario: Inventory-added and Return lines also snapshot

- **WHEN** a line is inserted via `fn_request_inventory_add_items` or `fn_request_create_return`
- **THEN** its `purchase_price_snapshot` SHALL be populated the same way

### Requirement: Cost amounts in accounts payloads

`fn_accounts_summary` and `fn_accounts_top_products` SHALL return cost-basis amounts alongside the existing MRP amounts, using the same quantity COALESCE chains as their MRP counterparts with `COALESCE(purchase_price_snapshot, 0)` as the price:

- Summary: `requested_cost`, `dispatched_cost`, `returns_cost`, `net_cost` (= dispatched − returns, the "Purchased at Cost" figure).
- Top products: `cost_amount` per product row (net of returns, mirroring `amount`).

`fn_accounts_by_shop` and `fn_accounts_by_category` keep their existing `purchase_amount / profit / loss` columns, re-based onto the snapshot. All cost fields SHALL flow through entities, DTOs, and FE types in every response — regardless of any UI basis selection.

#### Scenario: Summary returns both bases

- **WHEN** `GET /api/accounts/summary` is called
- **THEN** the response SHALL contain the four MRP amounts and the four cost amounts in a single payload

#### Scenario: Per-shop purchase reconciles with summary

- **GIVEN** any filter combination
- **WHEN** by-shop rows and the summary are computed
- **THEN** Σ(row `purchase_amount`) SHALL equal the summary `net_cost`

### Requirement: MRP / Cost basis toggle

The Accounts dashboard SHALL offer a basis toggle with exactly two options, **MRP** (default) and **Cost**, tracked in the URL as `basis` and surviving refresh like the existing `view` param. Switching basis SHALL re-base the KPI cards and every money column in the by-shop, by-category and top-products tables onto the corresponding cost fields, and SHALL swap "(at MRP)" labels for "(at Cost)" — without any re-fetch (both bases are already in the payload). In Cost basis the Net KPI card SHALL present the **Purchased (at Cost)** figure (`net_cost`). The adjustments log and in-transit strip remain MRP-only. Excel exports SHALL always include both MRP and cost columns, independent of the toggle.

#### Scenario: Default is MRP

- **WHEN** the user navigates to `/admin/accounts` with no `basis` param
- **THEN** the dashboard SHALL render exactly the pre-existing MRP view and the toggle SHALL show MRP selected

#### Scenario: Switching to Cost re-bases without re-fetch

- **GIVEN** the dashboard is loaded with data
- **WHEN** the user selects Cost
- **THEN** the KPI cards and table money columns SHALL show cost values with "(at Cost)" labels, the URL SHALL carry `basis=cost`, and no new API request SHALL be issued

#### Scenario: Basis survives refresh

- **GIVEN** `basis=cost` in the URL
- **WHEN** the page is refreshed
- **THEN** the Cost basis SHALL still be selected

#### Scenario: Export unaffected by toggle

- **WHEN** the user exports by-shop while Cost basis is selected
- **THEN** the workbook SHALL contain the MRP columns and the cost columns exactly as when MRP is selected

### Requirement: Excel export endpoints

The system SHALL expose one Excel export endpoint per breakdown table:

- `GET /api/accounts/export/by-shop`
- `GET /api/accounts/export/by-category`
- `GET /api/accounts/export/top-products`
- `GET /api/accounts/export/adjustments`

Each SHALL accept the same query params as its on-screen counterpart, run the same SP, and stream an `.xlsx` workbook with `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and `Content-Disposition: attachment; filename=accounts-<table>_<from>_to_<to>.xlsx`. Header rows match on-screen column labels; by-shop, by-category and top-products SHALL include the cost columns (`Purchase Amount`, `Profit`, `Loss` where applicable, and top-products `Cost Amount`) alongside MRP columns.

#### Scenario: Filename and content type

- **WHEN** the user calls `GET /api/accounts/export/adjustments?from=2026-05-25&to=2026-05-31`
- **THEN** the response SHALL be an `.xlsx` stream with `Content-Disposition: attachment; filename=accounts-adjustments_2026-05-25_to_2026-05-31.xlsx`

#### Scenario: Top-products export includes cost

- **WHEN** the user exports top-products
- **THEN** the workbook SHALL include a cost-amount column alongside the MRP amount

## MODIFIED Requirements

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
- **Purchased value (at Cost)** — net dispatched cost at `purchase_price_snapshot` (Orders Σ dispatched-qty-chain × snapshot − Returns Σ returned-qty-chain × snapshot), displayed on screen in both bases

In Cost basis the Requested / Dispatched / Returns / Net money columns SHALL re-base onto the snapshot-cost equivalents with "(at Cost)" headers. The sum of the per-shop Adjustments column over all shops SHALL equal the KPI Adjustments value for the same filters, and the sum of per-shop Net SHALL equal the KPI Net.

Rows SHALL be sorted by shop name ascending by default. Numeric columns SHALL have fixed widths so that when the table is narrower than the sum of column widths, a horizontal scrollbar appears rather than columns shrinking. Clicking a row SHALL navigate to `/admin/requests` with the shop and date range pre-applied via URL params.

#### Scenario: Sort default

- **WHEN** the shop breakdown loads with multiple shops
- **THEN** rows SHALL appear in ascending alphabetical order of shop name

#### Scenario: Per-shop net reconciles with KPI

- **GIVEN** any filter combination
- **WHEN** the by-shop rows and the KPI strip are computed
- **THEN** Σ(row Net) SHALL equal the KPI Net and Σ(row Adjustments) SHALL equal the KPI Adjustments

#### Scenario: Purchased column visible

- **WHEN** the shop breakdown renders in either basis
- **THEN** a Purchased (at Cost) column SHALL be present

#### Scenario: Narrow viewport scrolls horizontally

- **WHEN** the viewport is narrower than the sum of the table's column widths
- **THEN** the table SHALL present a horizontal scrollbar and column content SHALL NOT be truncated by shrinking

#### Scenario: Drilldown link

- **WHEN** the user clicks a row for shop `SHP012` in a range of `2026-05-25 → 2026-05-31`
- **THEN** the browser SHALL navigate to `/admin/requests?shop_id=<uuid>&from=2026-05-25&to=2026-05-31`

## REMOVED Requirements

### Requirement: CSV export endpoints

**Reason**: The four Accounts exports were converted to Excel (`.xlsx` via ClosedXML, `AccountsXlsxWriter`) — CSV no longer exists in the code; this delta brings the spec in line and adds the Excel requirement below.

**Migration**: Use the same routes (`GET /api/accounts/export/{by-shop,by-category,top-products,adjustments}`); responses are now `.xlsx` with MIME `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
