namespace KovilpattiSnacks.Business.DTOs.ShopInventory;

/// One product line in a stock-take session. `QtyDiff = CountedQty − SystemQty`
/// is a stored generated column in the DB. `SystemQty` is snapshotted at
/// session start (via fn_stock_take_start) OR at line-first-write
/// (via fn_stock_take_upsert_line) — the count is stable even if operational
/// movements happen mid-count.
public record StockTakeItemDto(
    Guid    ProductId,
    string  ProductCode,
    string  ProductName,
    decimal SystemQty,
    decimal CountedQty,
    decimal QtyDiff,
    string? Note);
