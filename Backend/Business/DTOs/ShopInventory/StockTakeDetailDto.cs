namespace KovilpattiSnacks.Business.DTOs.ShopInventory;

/// Full stock-take session for the count / review screen — header info +
/// every item snapshot. `Items` empty for a freshly-started session before
/// any lines are counted.
public record StockTakeDetailDto(
    Guid    Id,
    string  Code,
    Guid    ShopId,
    string  Status,
    DateTime StartedAt,
    DateTime? SubmittedAt,
    string? Notes,
    IReadOnlyList<StockTakeItemDto> Items);
