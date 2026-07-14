namespace KovilpattiSnacks.Business.DTOs.ShopInventory;

/// One row from the shop's inventory ledger. `QtyDelta` is signed
/// (+ receipt / − sale). `QtyAfter` is the running on_hand snapshot after
/// this movement — computed at write time by fn_shop_inventory_apply_movement.
public record ShopInventoryMovementDto(
    Guid    Id,
    Guid    ProductId,
    string  ProductCode,
    string  ProductName,
    string  MovementType,       // Opening / Receipt / Sale / Return / Adjustment / Refund
    decimal QtyDelta,
    decimal QtyAfter,
    decimal? UnitCost,
    string  RefType,             // Opening / StockRequest / Bill / StockTake / ManualAdjustment / BillReturn
    Guid?   RefId,
    string? Note,
    DateTime CreatedAt,
    Guid?   CreatedBy,
    string? CreatedByName);
