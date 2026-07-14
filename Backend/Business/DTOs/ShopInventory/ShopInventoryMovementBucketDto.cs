namespace KovilpattiSnacks.Business.DTOs.ShopInventory;

/// Period rollup bucketed by movement_type. Consumed by the dashboard's
/// "today's activity" strip (Receipts / Sales / Adjustments cards).
public record ShopInventoryMovementBucketDto(
    string  MovementType,
    decimal TotalQty,
    long    TotalLines,
    decimal TotalValue);
