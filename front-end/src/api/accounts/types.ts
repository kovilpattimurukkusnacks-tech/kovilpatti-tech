/**
 * Accounts API — TypeScript types mirroring the BE DTOs at
 * Backend/Business/DTOs/Accounts/AccountsDtos.cs.
 *
 * All amounts are INR at the line items' `unit_price` snapshot (= retail
 * MRP at submit time). The UI labels these columns "MRP value" so they
 * aren't mistaken for revenue or margin.
 */

/** ISO 8601 date string in IST calendar form: `yyyy-MM-dd`. */
export type IsoDate = string
/** ISO 8601 timestamp (UTC) returned by the BE for `DateTimeOffset` fields. */
export type IsoDateTime = string

export type AccountsGrouping = 'day' | 'week' | 'month'

export type AccountsTopProductsLimit = 10 | 25 | 50

/**
 * View / lens for the whole Accounts dashboard (19-Jun-2026, client #13).
 * Switches which dimension every panel surfaces:
 *   - 'all'        → current behaviour (every dimension visible)
 *   - 'requested'  → only requested-side data (Order requests pre-dispatch)
 *   - 'dispatched' → only dispatched-side data (what actually went out)
 *   - 'returns'    → only returns-side data
 *
 * Backed by the URL `?view=…` query param. FE-only filter for KPI strip,
 * shop breakdown, adjustments, in-transit (their SPs already return all
 * dims). Category + top-products SPs got additive per-dim aggregates so
 * FE can pick the right field at render time.
 */
// 12-Jul-2026 (client req) — 'purchased' added as a cost-basis lens.
// Same data slice as 'dispatched' but pivots the amount column from MRP
// (revenue) to purchase_price_snapshot (cost) so the client can see the
// tenant's investment side by shop / category alongside the P&L pair.
export type AccountsView = 'all' | 'requested' | 'dispatched' | 'returns' | 'purchased'

/** Shared query-string filters for every Accounts endpoint. */
export type AccountsFilters = {
  from: IsoDate
  to:   IsoDate
  grouping?: AccountsGrouping
  /** UUIDs. Sent as a comma-separated query value. */
  shopIds?:      string[]
  inventoryIds?: string[]
  /** Category int ids. Sent as a comma-separated query value. */
  categoryIds?:  number[]
  /** Only meaningful for top-products. */
  limit?: AccountsTopProductsLimit
  /** View / lens — defaults to 'all'. */
  view?: AccountsView
}

export type AccountsSummaryDto = {
  /** Σ requested_qty × unit_price over received-in-range Orders. */
  requestedAmount:        number
  /** Live: Σ COALESCE(dispatched_qty, requested_qty) × unit_price — a
   *  post-completion qty edit moves this (and Net) immediately. */
  dispatchedAmount:       number
  dispatchedRequestCount: number
  returnsAmount:          number
  returnsRequestCount:    number
  /** Dispatched − Returns. Adjustments are NOT added — the live dispatched
   *  figure already reflects every qty edit. */
  netAmount:              number
  activeShopCount:        number
  /** Informational: edits whose edited_at falls in range. */
  adjustmentsAmount:      number
  adjustmentsCount:       number
  /** 12-Jul-2026: Purchased (at Cost) — net dispatched cost at the line's
   *  frozen purchase_price_snapshot (Orders cost − Returns cost). */
  purchaseAmount:         number
}

export type AccountsTrendBucketDto = {
  bucketStart:       IsoDate
  dispatchedAmount:  number
  returnsAmount:     number
  netAmount:         number
  /** 12-Jul-2026: Purchased (at Cost) per bucket — net dispatched cost at
   *  the line's frozen purchase_price_snapshot. */
  purchaseAmount:    number
  /** 12-Jul-2026 (client): MRP value shops requested but did not get
   *  (stock short at the godown). Per-line requested − sent, floored at 0. */
  shortfallAmount:   number
}

export type AccountsShopRowDto = {
  shopId:               string
  shopCode:             string
  shopName:             string
  orderRequestCount:    number
  returnRequestCount:   number
  requestedQty:         number
  dispatchedQty:        number
  /** Accepted qty on Returns (dispatched_qty column reused). */
  returnedQty:          number
  requestedAmount:      number
  dispatchedAmount:     number
  returnsAmount:        number
  /** Informational — NOT folded into netAmount (see AccountsSummaryDto). */
  adjustmentsAmount:    number
  netAmount:            number
  /** Net cost of dispatched goods at the line's frozen
   *  purchase_price_snapshot (12-Jul-2026 — was live purchase_price).
   *  Shown on screen as Purchased (Cost) and in the by-shop Excel export. */
  purchaseAmount:       number
  /** Profit and loss are mutually exclusive — exactly one is non-zero per row
   *  (Indian P&L pair convention). Excel-export-only. */
  profit:               number
  loss:                 number
}

/** Signed Quantity / Amount — Returns subtract so category Net matches
 *  the page-level Net KPI. */
export type AccountsCategoryRowDto = {
  categoryId:   number
  categoryPath: string
  quantity:     number
  amount:       number
  /** 17-Jun-2026 (client #12): net cost of dispatched goods at current
   *  products.purchase_price. NOT displayed in the on-screen
   *  CategoryAndProductsTable — surfaced only in the by-category Excel export. */
  purchaseAmount: number
  /** Profit and loss are mutually exclusive — exactly one is non-zero per row
   *  (Indian P&L pair convention). Excel-export-only. */
  profit:       number
  loss:         number
  /** 19-Jun-2026 (client #13): per-dimension positive aggregates for the
   *  view-mode lens. FE picks the right field at render time. */
  requestedQty:      number
  dispatchedQty:     number
  returnsQty:        number
  requestedAmount:   number
  dispatchedAmount:  number
  returnsAmount:     number
}

/** Same signed semantics as the category breakdown. */
export type AccountsProductRowDto = {
  productId:   string
  productCode: string
  productName: string
  weightValue: number | null
  weightUnit:  string | null
  quantity:    number
  amount:      number
  /** 19-Jun-2026 (client #13): per-dim aggregates — see AccountsCategoryRowDto. */
  requestedQty:      number
  dispatchedQty:     number
  returnsQty:        number
  requestedAmount:   number
  dispatchedAmount:  number
  returnsAmount:     number
}

export type AccountsAdjustmentRowDto = {
  auditId:        string
  editedAt:       IsoDateTime
  requestId:      string
  requestCode:    string
  /** 'Order' or 'Return'. Added 19-Jun-2026 (client #13) so the FE filters
   *  audits by view-mode lens. */
  // 'Backorder' left in for legacy audit rows migrated to Order + is_special
  // — the BE emits the current request_type, so historical audits still land.
  requestType:    'Order' | 'Return' | 'Backorder'
  /** Shop-declared Special Request flag on the parent request (06-Jul-2026).
   *  Powers the amber "Special" chip next to the request code. */
  isSpecial:      boolean
  /** User-supplied Special Request label. Null when isSpecial is false. */
  specialLabel:   string | null
  shopId:         string
  shopName:       string
  productId:      string
  productName:    string
  weightValue:    number | null
  weightUnit:     string | null
  oldQty:         number | null
  newQty:         number | null
  deltaQty:       number
  unitPrice:      number
  deltaAmount:    number
  reason:         string | null
  editedById:     string | null
  editedByName:   string | null
}

export type AccountsInTransitDto = {
  requestCount:        number
  totalAmount:         number
  /** Null when requestCount is 0. */
  oldestDispatchedAt:  IsoDateTime | null
  /** Subset of requestCount that are Special Requests (06-Jul-2026).
   *  0 when none of the in-transit orders are special. */
  specialCount:        number
  /** Sum of total_amount over the Special-only subset. */
  specialAmount:       number
}

/** Company-wide total of Inventory-role staff Pay/Deduct in the date range
 *  (18-Jul-2026). Godowns aren't shop-scoped, so this is a single figure —
 *  not a per-shop breakdown like AccountsUtilityRowDto — that feeds Net
 *  Profit as its own line item alongside Shop Expenses. */
export type AccountsGodownExpensesDto = {
  amount: number
}

/** One row per (shop, utility category) in the selected date range. Powers
 *  the Net Profit KPI + Utilities columns (15-Jul-2026). Shops with zero
 *  utilities in range are absent — treat missing shops as ₹0. */
export type AccountsUtilityRowDto = {
  shopId:       string
  shopCode:     string
  shopName:     string
  /** Free text: Electricity / Rent / Water / Staff Salary / Maintenance /
   *  Internet/Wifi / Others (FE autocomplete suggestions). Anything else
   *  falls back to a generic icon in the UI. */
  category:     string
  amount:       number
  expenseCount: number
}

/** One row per (inventory, category) — godown/inventory operational
 *  expenses (21-Jul-2026). Mirror of AccountsUtilityRowDto but scoped
 *  to a godown instead of a shop. Feeds the "Inventory Expenses" line
 *  on the admin Accounts screen. Godowns with zero expenses in range
 *  are absent — treat missing as ₹0. */
export type AccountsInventoryExpenseRowDto = {
  inventoryId:   string
  inventoryCode: string
  inventoryName: string
  category:      string
  amount:        number
  expenseCount:  number
}
