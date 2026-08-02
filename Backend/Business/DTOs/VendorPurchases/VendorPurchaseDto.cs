namespace KovilpattiSnacks.Business.DTOs.VendorPurchases;

public record VendorPurchaseDto(
    Guid Id,
    string Code,
    Guid VendorId,
    string VendorCode,
    string VendorName,
    Guid GodownId,
    string GodownCode,
    string GodownName,
    /// Derived server-side from vendors.state_code <> '33' at insert time.
    /// Frozen — not recomputed if the vendor's state is edited later.
    bool IsInterstate,
    string InvoiceNumber,
    DateOnly InvoiceDate,
    decimal InvoiceAmount,
    /// "Ordered" | "Received"
    string Status,
    int TotalItems,
    decimal TotalQty,
    decimal TotalAmount,
    string? Notes,
    DateTimeOffset? ReceivedAt,
    string? ReceivedByName,
    DateTimeOffset CreatedAt,
    /// Phase 5b — e-way compliance summary from the list SP. One of
    /// "NotRequired" | "Attached" | "Missing". Null on GET /{id} because
    /// the detail page renders the full e-way section instead.
    string? EwayStatus,
    /// Only populated by GET /{id}. Null on list endpoints.
    IReadOnlyList<VendorPurchaseItemDto>? Items
);

public record VendorPurchaseItemDto(
    Guid Id,
    Guid ProductId,
    string ProductCode,
    string ProductName,
    decimal Qty,
    decimal UnitCost,
    decimal LineTotal,
    /// Snapshot of the product's pack weight at purchase time. Null when
    /// the product has no weight set.
    decimal? WeightValue,
    /// 'g' or 'kg'. Null when WeightValue is null.
    string? WeightUnit
);
