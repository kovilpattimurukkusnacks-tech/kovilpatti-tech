namespace KovilpattiSnacks.Business.DTOs.StockRequests;

public record StockRequestDto(
    Guid   Id,
    string Code,
    Guid   ShopId,
    string ShopCode,
    string ShopName,
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
    string Status,
    int    TotalItems,
    int    TotalQty,
    // Sum of dispatched_qty across items — null until inventory dispatches.
    int?   TotalDispatchedQty,
    decimal TotalAmount,
    // Sum of (dispatched_qty × unit_price) — null until dispatch.
    decimal? TotalDispatchedAmount,
    string? Notes,
    string? RejectionReason,
    DateTimeOffset  EditableUntil,
    DateTimeOffset  SubmittedAt,
    DateTimeOffset? ApprovedAt,
    Guid?           ApprovedBy,
    DateTimeOffset? DispatchedAt,
    Guid?           DispatchedBy,
    DateTimeOffset? ReceivedAt,
    DateTimeOffset? CancelledAt,
    Guid?           CancelledBy,
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
    decimal UnitPrice,
    decimal Subtotal
);
