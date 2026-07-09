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
  /** Shop's actual counted qty at confirm-receipt time. Null = "no
   *  discrepancy noted" (received == dispatched); non-null = shop
   *  entered a different number. Drives the short/over highlight on
   *  the shop/admin detail pages after status=Received. */
  receivedQty: number | null
  /** Return-only partial-weight claim (grams). Null on Orders + full-pack
   *  Returns. Non-null = shop asked for credit on a fraction of a pack
   *  (damage claim, no physical goods movement). Only set on g/kg SKUs. */
  returnWeightG: number | null
  // Inventory user's saved-but-not-finalised dispatch qty. Used to pre-fill
  // the dispatch screen's qty inputs from a saved draft. Null when no draft
  // exists (or after the dispatch has been finalised).
  draftDispatchedQty: number | null
  unitPrice: number
  subtotal: number
  /** 'Shop' (default) or 'Inventory'. Inv-tagged rows were appended by
   *  the godown post-approval via the Add Products dialog. FE detail
   *  pages / prints render an (inv) chip alongside these products so
   *  the shop / picker can see which items came in later. */
  addedBy: 'Shop' | 'Inventory'
}

// 'Order' = shop → godown; 'Return' = goods back to godown. 'Backorder'
// remains in the BE enum for legacy rows migrated on 06-Jul-2026 but
// nothing new writes it — the shop-declared is_special flag replaced it.
export type RequestType = 'Order' | 'Return' | 'Backorder'

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
  /** Signed sum of (received_qty − dispatched_qty) across items with
   *  received_qty set. Null = no discrepancy at all; 0 = reported but
   *  net-zero; ±N = short (−) or over (+). Populates the "Adjustment Qty"
   *  column on the request-list tables. 03-Jul-2026. */
  totalAdjustmentQty: number | null
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
  /** ISO timestamp set when the dispatch draft was pinned (null = not pinned).
   *  Pinned drafts sort to the top of the resume strip. */
  pinnedAt: string | null
  /** Shop-declared "special / vendor procurement" flag (06-Jul-2026). Set
   *  on the review/submit step; frozen once the request is Approved.
   *  Drives the sticky top banner + list-row highlight until Received. */
  isSpecial: boolean
  /** User-supplied name for the special request ("Diwali stock 2026").
   *  Null when isSpecial is false, or when the shop left it blank — UI
   *  defaults to "Special Request". */
  specialLabel: string | null
  items: StockRequestItemDto[] | null  // only on GET /{id}
}

export type CreateStockRequestItem = {
  productId: string
  requestedQty: number
  /** Return-only. Non-null → shop is claiming credit for `returnWeightG`
   *  grams from `requestedQty` pack(s). Only valid on g/kg SKUs. */
  returnWeightG?: number | null
}

export type CreateStockRequestRequest = {
  notes?: string
  items: CreateStockRequestItem[]
  /** 06-Jul-2026 (client req): shop marks the whole request as a
   *  vendor-procured special order on the review/submit step. Omit /
   *  false for a normal request. */
  isSpecial?: boolean
  /** User-supplied name for a special request. Ignored unless
   *  isSpecial=true. Trimmed + null-emptied server-side. */
  specialLabel?: string | null
  /** Admin-only (08-Jul-2026): raise this request on behalf of a
   *  specific shop. Required when the caller is Admin, forbidden for
   *  ShopUser (BE rejects any supplied value that doesn't match the
   *  caller's own shop). Shop users MUST omit this field. */
  shopId?: string
}

export type UpdateStockRequestRequest = CreateStockRequestRequest

export type RejectRequest = { reason: string }

// dispatchedQty is nullable ONLY on the SAVE-DRAFT path — sending null
// tells the SP to clear this item's persisted draft (used when the
// godown erases a qty mid-edit). On the FINAL dispatch endpoint the BE
// still validates non-null; the shared type keeps both paths honest.
export type DispatchItem = { id: string; dispatchedQty: number | null }

/** Shop's confirm-receipt payload. Items list is OPTIONAL — omit / empty
 *  for the one-click "as-dispatched" confirm. Populate to record a
 *  discrepancy (short or over-count). Only lines that differ from the
 *  dispatched qty need to be in the list. */
export type ReceiveItem = { id: string; receivedQty: number }
export type ReceiveRequest = { items?: ReceiveItem[] }
export type DispatchRequest = { items: DispatchItem[] }

/** Set / clear the godown's free-text label on a saved dispatch draft.
 *  Empty / whitespace-only name clears the existing label. */
export type RenameDispatchDraftRequest = { name: string | null }

/** Pin / unpin a saved dispatch draft. Pinned drafts sort to the top of
 *  the resume strip. Re-pinning bumps the timestamp (re-prioritises). */
export type PinDispatchDraftRequest = { pinned: boolean }

/** Inventory / Admin appends new product lines to a Pending / Approved
 *  request. Each row is inserted with addedBy='Inventory'. The BE rejects
 *  duplicates — use the dispatch-qty flow to send more of a shop-included
 *  product. */
export type InventoryAddItemsRequest = {
  items: { productId: string; requestedQty: number }[]
}

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

// Shop toggles the "special / vendor procurement" flag on a Pending
// request (PATCH /requests/{id}/special). Once approved the flag freezes.
// specialLabel is optional — trimmed + null-emptied server-side; when
// isSpecial is false, any label is discarded.
export type SetSpecialRequest = {
  isSpecial: boolean
  specialLabel?: string | null
}

/** One row on the "active specials" feed powering the sticky top banner
 *  across shop / inv / admin. Never date-filtered — surfaces cross-month
 *  specials until the shop confirms Received. */
export type ActiveSpecialDto = {
  id: string
  code: string
  specialLabel: string | null
  shopId: string
  shopCode: string
  shopName: string
  inventoryId: string
  inventoryName: string
  status: RequestStatus
  totalItems: number
  totalQty: number
  totalAmount: number
  submittedAt: string
  daysSinceSubmitted: number
}

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
  orderQty: number
  specialQty: number
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
