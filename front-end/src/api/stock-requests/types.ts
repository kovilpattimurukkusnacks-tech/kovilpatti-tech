/** Mirrors the BE StockRequestDto + supporting request DTOs. */

export type RequestStatus =
  | 'Draft'
  | 'Pending'
  | 'Approved'
  | 'Rejected'
  | 'Dispatched'
  | 'Received'
  | 'Cancelled'
  // Terminal state for Returns — set by fn_request_accept_return when the
  // inventory user accepts the goods back. Never appears on Orders.
  | 'Accepted'

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
  // Inventory user's saved-but-not-finalised dispatch qty. Used to pre-fill
  // the dispatch screen's qty inputs from a saved draft. Null when no draft
  // exists (or after the dispatch has been finalised).
  draftDispatchedQty: number | null
  unitPrice: number
  subtotal: number
}

// 'Order' = shop → godown (forward); 'Return' = goods back to godown.
// Same DTO shape carries both — flip behaviour by the requestType field.
export type RequestType = 'Order' | 'Return'

export type StockRequestDto = {
  id: string
  code: string
  shopId: string
  shopCode: string
  shopName: string
  /** Shop's primary contact phone — populated on the detail endpoint
   *  (used by the thermal print header). Null on list rows. */
  shopContactPhone: string | null
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
  // Inventory user who accepted a Return; null for Orders / unaccepted Returns.
  acceptedByName: string | null
  status: RequestStatus
  // 'Order' on the legacy flow; 'Return' on the new return-stock flow.
  requestType: RequestType
  totalItems: number
  totalQty: number
  // Sum of dispatched_qty across items. Null until inventory dispatches.
  // On a Return this is the godown-accepted qty.
  totalDispatchedQty: number | null
  totalAmount: number
  // Sum of (dispatched_qty × unit_price). Null until dispatch / accept.
  totalDispatchedAmount: number | null
  notes: string | null
  rejectionReason: string | null
  editableUntil: string                // ISO string
  submittedAt: string
  // Last row-touch timestamp. For drafts this is the last save; for
  // finalised requests it's the last status flip or edit.
  updatedAt: string
  approvedAt: string | null
  approvedBy: string | null
  dispatchedAt: string | null
  dispatchedBy: string | null
  receivedAt: string | null
  // Return terminal — when the godown accepted the return. Null on Orders.
  acceptedAt: string | null
  acceptedBy: string | null
  cancelledAt: string | null
  cancelledBy: string | null
  // Return-only: the Order this Return reverses. Null for Orders / free-form Returns.
  sourceRequestId: string | null
  // The linked Order's code (e.g. "REQ0042"). Null when sourceRequestId is null.
  sourceRequestCode: string | null
  // Godown-supplied label on a saved dispatch draft (30-Jun-2026). Populated
  // by the inventory dispatch-drafts list endpoint; null on every other list,
  // on un-named drafts, and on finalised requests.
  draftName: string | null
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

/** Set / clear the godown's free-text label on a saved dispatch draft.
 *  Empty / whitespace-only name clears the existing label. */
export type RenameDispatchDraftRequest = { name: string | null }

// Shop user creating a Return — items going BACK to the godown. SourceRequestId
// is optional: when provided, links the Return to the past Order being reversed
// so Phase 3 accounts can post a precise reverse entry. Item shape is the same
// as CreateStockRequestRequest (BE reuses BuildItemsJsonAsync).
export type CreateReturnRequest = {
  sourceRequestId?: string | null
  notes?: string
  items: CreateStockRequestItem[]
}

// Inventory user accepting a Pending Return. Partial accepts allowed (acceptedQty
// may be less than what the shop claimed they were returning). Internally maps
// to the dispatched_qty column — same data path as DispatchRequest, different
// semantic.
export type AcceptReturnItem = { id: string; acceptedQty: number }
export type AcceptReturnRequest = { items: AcceptReturnItem[] }

// Admin's post-completion qty correction (client #9). Valid only on Received
// Orders + Accepted Returns. `newQty=null` clears the value back to NULL;
// otherwise must be >= 0. `reason` is optional free-text up to 500 chars —
// Phase 3 accounts shows it verbatim on its reconciliation entries.
export type EditDispatchedQtyRequest = {
  newQty: number | null
  reason?: string
}

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
  // IST calendar dates (YYYY-MM-DD). Filter on submitted_at. Inclusive of both ends.
  fromDate?: string
  toDate?: string
  // 'Order' / 'Return' — when set, restricts to that request_type. Drives the
  // "Return" preset chip on ShopRequests + InventoryRequests.
  requestType?: RequestType
}

export type PagedResult<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}
