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
}

/** Signed Quantity / Amount — Returns subtract so category Net matches
 *  the page-level Net KPI. */
export type AccountsCategoryRowDto = {
  categoryId:   number
  categoryPath: string
  quantity:     number
  amount:       number
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
}

export type AccountsAdjustmentRowDto = {
  auditId:        string
  editedAt:       IsoDateTime
  requestId:      string
  requestCode:    string
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
}
