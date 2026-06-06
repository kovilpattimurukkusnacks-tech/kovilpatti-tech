namespace KovilpattiSnacks.Business.DTOs.Accounts;

/// <summary>
/// Accounts API DTOs. All `Amount` fields are in INR using the line items'
/// `unit_price` snapshots (= retail MRP at submit time) — the FE labels
/// these columns "MRP value" so consumers don't mistake them for revenue.
/// </summary>

public record AccountsSummaryDto(
    decimal RequestedAmount,
    decimal DispatchedAmount,
    long    DispatchedRequestCount,
    decimal ReturnsAmount,
    long    ReturnsRequestCount,
    decimal NetAmount,
    long    ActiveShopCount,
    decimal AdjustmentsAmount,
    long    AdjustmentsCount
);

public record AccountsTrendBucketDto(
    DateOnly BucketStart,
    decimal  DispatchedAmount,
    decimal  ReturnsAmount,
    decimal  NetAmount
);

public record AccountsShopRowDto(
    Guid    ShopId,
    string  ShopCode,
    string  ShopName,
    long    OrderRequestCount,
    long    ReturnRequestCount,
    long    RequestedQty,
    long    DispatchedQty,
    long    ReturnedQty,
    decimal RequestedAmount,
    decimal DispatchedAmount,
    decimal ReturnsAmount,
    /// Informational — edits posted in range; NOT folded into NetAmount
    /// (the live DispatchedAmount already reflects them).
    decimal AdjustmentsAmount,
    decimal NetAmount
);

/// Signed quantity / amount — Returns subtract so category Net reflects
/// the page-level Net KPI.
public record AccountsCategoryRowDto(
    int     CategoryId,
    string  CategoryPath,
    long    Quantity,
    decimal Amount
);

/// Signed quantity / amount, same semantics as the category breakdown.
public record AccountsProductRowDto(
    Guid     ProductId,
    string   ProductCode,
    string   ProductName,
    decimal? WeightValue,
    string?  WeightUnit,
    long     Quantity,
    decimal  Amount
);

public record AccountsAdjustmentRowDto(
    Guid            AuditId,
    DateTimeOffset  EditedAt,
    Guid            RequestId,
    string          RequestCode,
    Guid            ShopId,
    string          ShopName,
    Guid            ProductId,
    string          ProductName,
    decimal?        WeightValue,
    string?         WeightUnit,
    int?            OldQty,
    int?            NewQty,
    int             DeltaQty,
    decimal         UnitPrice,
    decimal         DeltaAmount,
    string?         Reason,
    Guid?           EditedById,
    string?         EditedByName
);

public record AccountsInTransitDto(
    long            RequestCount,
    decimal         TotalAmount,
    /// Null when RequestCount is 0.
    DateTimeOffset? OldestDispatchedAt
);
