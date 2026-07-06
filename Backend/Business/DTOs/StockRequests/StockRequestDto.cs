namespace KovilpattiSnacks.Business.DTOs.StockRequests;

public record StockRequestDto(
    Guid   Id,
    string Code,
    Guid   ShopId,
    string ShopCode,
    string ShopName,
    /// Shop's primary contact phone for the thermal print header. Populated
    /// by fn_request_get only; null on list rows (the list SPs don't return it).
    string? ShopContactPhone,
    Guid   InventoryId,
    string InventoryCode,
    string InventoryName,
    /// Full name of the user who first created the request. Null if the user has been deleted.
    string? SubmittedByName,
    /// Admin who approved this request. Null pre-approval.
    string? ApprovedByName,
    /// Inventory user who marked the request Dispatched. Null pre-dispatch.
    string? DispatchedByName,
    /// Shop user who confirmed receipt. Null until the request is Received.
    string? ReceivedByName,
    /// Inventory user who accepted a Return. Null for Orders / unaccepted Returns.
    string? AcceptedByName,
    string Status,
    /// "Order" (shop → godown) or "Return" (goods back to godown).
    string RequestType,
    int    TotalItems,
    int    TotalQty,
    // Sum of dispatched_qty across items — null until inventory dispatches.
    // On a Return this is the godown-accepted qty.
    int?   TotalDispatchedQty,
    /// Signed aggregate of (received_qty − dispatched_qty) across items
    /// with received_qty set. Null = no discrepancies reported; 0 = net-
    /// zero; ±N = short (−) or over (+). Powers the "Adjustment Qty"
    /// column on the shop / inventory / admin request-list tables.
    int?   TotalAdjustmentQty,
    decimal TotalAmount,
    // Sum of (dispatched_qty × unit_price) — null until dispatch / accept.
    decimal? TotalDispatchedAmount,
    string? Notes,
    string? RejectionReason,
    DateTimeOffset  EditableUntil,
    DateTimeOffset  SubmittedAt,
    /// Last row-touch timestamp. Refreshed by every write — useful for
    /// drafts (= last save) and for any "last activity" display.
    DateTimeOffset  UpdatedAt,
    DateTimeOffset? ApprovedAt,
    Guid?           ApprovedBy,
    DateTimeOffset? DispatchedAt,
    Guid?           DispatchedBy,
    DateTimeOffset? ReceivedAt,
    /// Return terminal — when the godown accepted the return. Null on Orders.
    DateTimeOffset? AcceptedAt,
    Guid?           AcceptedBy,
    DateTimeOffset? CancelledAt,
    Guid?           CancelledBy,
    /// Return-only: the Order this Return reverses. Null for Orders / free-form Returns.
    Guid?   SourceRequestId,
    /// The linked Order's code (e.g. "REQ0042"). Null when SourceRequestId is null.
    string? SourceRequestCode,
    /// Godown-supplied label on a saved dispatch draft (30-Jun-2026). Surfaces
    /// on the inventory dispatch-drafts list endpoint; null on every other
    /// list, on un-named drafts, and on finalised requests.
    string? DraftName,
    /// When the dispatch draft was pinned (null = not pinned). Pinned drafts
    /// sort first on the resume strip. Cleared on discard / dispatch alongside
    /// DraftName.
    DateTimeOffset? PinnedAt,
    /// Shop-declared "special / vendor procurement" flag (06-Jul-2026). Set
    /// on the review/submit step; frozen once the request is Approved.
    /// Drives the sticky top banner + list-row highlight until Received.
    bool    IsSpecial,
    /// User-supplied name for the special request. Null when IsSpecial is
    /// false; when true, may still be null (shop left it blank — UI defaults
    /// to "Special Request"). DB enforces label-only-when-special.
    string? SpecialLabel,
    /// Only populated by GET /{id}. Null on list endpoints.
    IReadOnlyList<StockRequestItemDto>? Items
);

public record StockRequestItemDto(
    Guid    Id,
    Guid    ProductId,
    string  ProductCode,
    string  ProductName,
    /// Category name read live from the product master at request-detail time.
    /// Used by the picklist print to group products by category.
    string  CategoryName,
    /// Snapshot of the product's pack weight (e.g. 100 for 100 g, 1 for 1 kg).
    /// Null when the product has no weight set.
    decimal? WeightValue,
    /// 'g' or 'kg'. Null when WeightValue is null.
    string?  WeightUnit,
    int     RequestedQty,
    int?    DispatchedQty,
    /// Shop's actual counted qty at confirm-receipt time. Null = "no
    /// discrepancy" (received == dispatched); non-null = the shop
    /// entered a different number. Read from stock_request_items.received_qty.
    int?    ReceivedQty,
    /// Return-only partial-weight claim (grams). Null on Orders and on
    /// full-pack Returns; non-null on damage-claim Returns where the shop
    /// requested credit for a fraction of a pack. Value calc:
    /// (ReturnWeightG / pack weight in grams) × UnitPrice.
    decimal? ReturnWeightG,
    /// Inventory user's saved-but-not-finalised dispatch quantity. Used by
    /// the dispatch screen to pre-fill qty inputs from a saved draft.
    /// NULL when no draft has been saved (or after the request is dispatched
    /// — fn_request_dispatch clears these on finalisation).
    int?    DraftDispatchedQty,
    decimal UnitPrice,
    decimal Subtotal,
    /// "Shop" (default) or "Inventory" — inv-tagged rows were appended by
    /// the godown post-approval via the Add Products dialog. Downstream
    /// views render an (inv) chip so shop / admin / picker can see which
    /// items came in later. 01-Jul-2026.
    string AddedBy
);
