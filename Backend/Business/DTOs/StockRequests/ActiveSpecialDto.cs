namespace KovilpattiSnacks.Business.DTOs.StockRequests;

/// One row on the "active specials" list (banner feed). Emitted for every
/// un-received Special request in the caller's scope. Wider status window
/// than the retired outstanding-backorders SP — Pending + Approved +
/// Dispatched all surface here, disappearing only when the shop confirms
/// Received (client's chosen closure gate). 06-Jul-2026.
public record ActiveSpecialDto(
    Guid    Id,
    string  Code,
    /// User-supplied name for this special ("Diwali stock 2026"). NULL when
    /// the shop left it blank — FE defaults to "Special Request".
    string? SpecialLabel,
    Guid    ShopId,
    string  ShopCode,
    string  ShopName,
    Guid    InventoryId,
    string  InventoryName,
    string  Status,
    int     TotalItems,
    int     TotalQty,
    decimal TotalAmount,
    DateTimeOffset SubmittedAt,
    /// Non-negative day count. Powers the banner's "N days old" hint so
    /// the reader can spot specials that have been sitting for too long.
    int     DaysSinceSubmitted
);
