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
export type AccountsView = 'all' | 'requested' | 'dispatched' | 'returns'

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
}

export type AccountsTrendBucketDto = {
  bucketStart:       IsoDate
  dispatchedAmount:  number
  returnsAmount:     number
  netAmount:         number
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
  /** 17-Jun-2026 (client #12): net cost of dispatched goods at current
   *  products.purchase_price. NOT displayed in the on-screen ShopBreakdownTable —
   *  surfaced only in the by-shop Excel export. */
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
