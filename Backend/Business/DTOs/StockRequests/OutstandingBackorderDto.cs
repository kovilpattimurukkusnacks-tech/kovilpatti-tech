namespace KovilpattiSnacks.Business.DTOs.StockRequests;

/// Pipeline-scoped snapshot row for the Outstanding Back-orders strip.
/// Distinct from the header DTO — the strip only needs the summary fields
/// so we skip the heavy joins on user names / dispatch aggregates etc.
///
/// Consumed by:
///   • Shop banner ("N back-orders outstanding")
///   • Inventory persistent banner + Procurement preset chip
///   • Admin Accounts pipeline strip (cross-month visibility — never
///     date-filtered so end-of-month back-orders stay visible until closed)
public record OutstandingBackorderDto(
    Guid    Id,
    string  Code,
    Guid?   ParentId,
    string? ParentCode,
    Guid    ShopId,
    string  ShopCode,
    string  ShopName,
    Guid    InventoryId,
    string  InventoryName,
    int     TotalItems,
    int     TotalQty,
    decimal TotalAmount,
    DateTimeOffset  SubmittedAt,
    /// Godown-supplied ETA. Null = "no ETA yet".
    DateTimeOffset? ExpectedArrivalAt,
    /// GREATEST(0, today - submitted_at::date). Drives "N days waiting"
    /// muted-red styling on the strip after > 3 days.
    int DaysSinceSubmitted
);
