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
    long    AdjustmentsCount,
    /// 12-Jul-2026: Purchased (at Cost) — net dispatched cost at the line's
    /// frozen purchase_price_snapshot (Orders cost − Returns cost).
    decimal PurchaseAmount
);

public record AccountsTrendBucketDto(
    DateOnly BucketStart,
    decimal  DispatchedAmount,
    decimal  ReturnsAmount,
    decimal  NetAmount,
    /// 12-Jul-2026: Purchased (at Cost) per bucket — net dispatched cost at
    /// the line's frozen purchase_price_snapshot.
    decimal  PurchaseAmount,
    /// 12-Jul-2026 (client): MRP value shops requested but did not get
    /// (per-line requested − sent, floored at 0; Orders only).
    decimal  ShortfallAmount
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
    decimal NetAmount,
    /// 17-Jun-2026 (client #12): net cost of dispatched goods at current
    /// products.purchase_price (Orders cost − Returns cost). Profit/Loss
    /// is the P&L pair against NetAmount — exactly one is non-zero.
    decimal PurchaseAmount,
    decimal Profit,
    decimal Loss
);

/// Signed quantity / amount — Returns subtract so category Net reflects
/// the page-level Net KPI.
public record AccountsCategoryRowDto(
    int     CategoryId,
    string  CategoryPath,
    long    Quantity,
    decimal Amount,
    /// 17-Jun-2026 (client #12): net cost of dispatched goods at current
    /// products.purchase_price. Profit/Loss is the P&L pair against Amount —
    /// exactly one is non-zero. Excel-export-only (not shown in the
    /// CategoryAndProductsTable grid).
    decimal PurchaseAmount,
    decimal Profit,
    decimal Loss,
    /// 19-Jun-2026 (client #13): per-dimension positive aggregates so the FE
    /// view-mode lens (Requested / Dispatched / Returns) can pick the right
    /// number per row without a refetch.
    long    RequestedQty,
    long    DispatchedQty,
    long    ReturnsQty,
    decimal RequestedAmount,
    decimal DispatchedAmount,
    decimal ReturnsAmount
);

/// Signed quantity / amount, same semantics as the category breakdown.
public record AccountsProductRowDto(
    Guid     ProductId,
    string   ProductCode,
    string   ProductName,
    decimal? WeightValue,
    string?  WeightUnit,
    long     Quantity,
    decimal  Amount,
    /// 19-Jun-2026 (client #13): per-dim aggregates (see AccountsCategoryRowDto).
    long     RequestedQty,
    long     DispatchedQty,
    long     ReturnsQty,
    decimal  RequestedAmount,
    decimal  DispatchedAmount,
    decimal  ReturnsAmount
);

public record AccountsAdjustmentRowDto(
    Guid            AuditId,
    DateTimeOffset  EditedAt,
    Guid            RequestId,
    string          RequestCode,
    /// 'Order' or 'Return'. Added 19-Jun-2026 (client #13) so FE filters
    /// audits by view-mode lens.
    string          RequestType,
    /// Shop-declared Special Request flag on the parent request. Renders
    /// the amber "Special" chip on the audit row (06-Jul-2026).
    bool            IsSpecial,
    /// User-supplied Special Request label. Null when IsSpecial is false
    /// or the shop left it blank — chip falls back to plain "Special".
    string?         SpecialLabel,
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
    DateTimeOffset? OldestDispatchedAt,
    /// Subset of RequestCount that are Special Requests (06-Jul-2026).
    /// Never exceeds RequestCount; 0 when none in transit are special.
    long            SpecialCount,
    /// Sum of total_amount over the Special-only subset.
    decimal         SpecialAmount
);

/// Company-wide total of Inventory-role staff Pay/Deduct in the date range
/// (18-Jul-2026, client req: "inventory users also should pay salary" —
/// should count as a real business expense, not just be tracked separately).
/// Godowns aren't shop-scoped like the rest of Accounts, so this is its own
/// line item feeding Net Profit rather than a per-shop utilities row.
public record AccountsGodownExpensesDto(decimal Amount);

/// One row per (shop, utility category) in the selected date range. Shops
/// with zero utilities in range are absent — FE treats missing shops as ₹0.
/// Used to derive the Net Profit KPI (Gross Profit − Utilities) and the
/// Utilities columns on the admin Accounts breakdowns (15-Jul-2026,
/// client req: "shop bills la ellam kalanjaa dhan real profit").
public record AccountsUtilityRowDto(
    Guid    ShopId,
    string  ShopCode,
    string  ShopName,
    /// Free text — the FE offers Electricity / Rent / Water / Staff Salary /
    /// Maintenance / Internet/Wifi / Others via autocomplete, but shops can
    /// log anything. Unknown values render on the FE with a fallback icon.
    string  Category,
    decimal Amount,
    long    ExpenseCount
);
