namespace KovilpattiSnacks.Business.DTOs.ShopInventory;

/// Stock-take session card — history list + dashboard "last stock-take"
/// widget. `NetDiffQty` is the signed sum of every line's qty_diff; large
/// magnitudes are a signal (either miscounted or genuine shrinkage).
public record StockTakeSummaryDto(
    Guid    Id,
    string  Code,
    string  Status,          // Draft / Submitted / Cancelled
    DateTime StartedAt,
    DateTime? SubmittedAt,
    long    ItemCount,
    long    DiffCount,
    decimal NetDiffQty);
