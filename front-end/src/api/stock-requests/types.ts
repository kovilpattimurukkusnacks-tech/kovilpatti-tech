/** Mirrors the BE StockRequestDto + supporting request DTOs. */

export type RequestStatus =
  | 'Pending'
  | 'Approved'
  | 'Rejected'
  | 'Dispatched'
  | 'Received'
  | 'Cancelled'

export type StockRequestItemDto = {
  id: string
  productId: string
  productCode: string
  productName: string
  // Category name (read live from products at request-detail time; not snapshotted).
  // Used by the picklist print to group products by category.
  categoryName: string
  // Snapshot of the product's pack weight (e.g. 100 for 100 g). Null when
  // the product has no weight set.
  weightValue: number | null
  weightUnit: string | null   // 'g' | 'kg'
  requestedQty: number
  dispatchedQty: number | null
  unitPrice: number
  subtotal: number
}

export type StockRequestDto = {
  id: string
  code: string
  shopId: string
  shopCode: string
  shopName: string
  inventoryId: string
  inventoryCode: string
  inventoryName: string
  // Full name of the user who first created the request; null if that user has been deleted.
  submittedByName: string | null
  // Admin who approved this request; null pre-approval.
  approvedByName: string | null
  // Inventory user who marked the request Dispatched; null pre-dispatch.
  dispatchedByName: string | null
  // Shop user who confirmed receipt; null until Received.
  receivedByName: string | null
  status: RequestStatus
  totalItems: number
  totalQty: number
  // Sum of dispatched_qty across items. Null until inventory dispatches.
  totalDispatchedQty: number | null
  totalAmount: number
  // Sum of (dispatched_qty × unit_price). Null until dispatch.
  totalDispatchedAmount: number | null
  notes: string | null
  rejectionReason: string | null
  editableUntil: string                // ISO string
  submittedAt: string
  approvedAt: string | null
  approvedBy: string | null
  dispatchedAt: string | null
  dispatchedBy: string | null
  receivedAt: string | null
  cancelledAt: string | null
  cancelledBy: string | null
  items: StockRequestItemDto[] | null  // only on GET /{id}
}

export type CreateStockRequestItem = {
  productId: string
  requestedQty: number
}

export type CreateStockRequestRequest = {
  notes?: string
  items: CreateStockRequestItem[]
}

export type UpdateStockRequestRequest = CreateStockRequestRequest

export type RejectRequest = { reason: string }

export type DispatchItem = { id: string; dispatchedQty: number }
export type DispatchRequest = { items: DispatchItem[] }

/** One row in the cumulative-pending workload report (kitchen batch plan). */
export type CumulativePendingLine = {
  productId: string
  productCode: string
  productName: string
  categoryName: string
  type: string
  weightValue: number | null
  weightUnit: string | null
  totalQty: number
  requestCount: number
}

/** One row of the per-shop request-count summary used by the list page's
 *  shop quick-filter chips. Shops with zero matching requests are omitted. */
export type ShopRequestCount = {
  shopId: string
  shopCode: string
  shopName: string
  requestCount: number
}

export type StockRequestListFilters = {
  shopId?: string
  inventoryId?: string
  status?: RequestStatus
  search?: string
  page?: number
  pageSize?: number
}

export type PagedResult<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}
