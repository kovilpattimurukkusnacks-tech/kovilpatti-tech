namespace KovilpattiSnacks.Business.DTOs.ShopInventory;

/// Single (shop, product) detail — used by the drill-down page that shows
/// current on-hand + movement history for one product.
public record ShopInventoryDetailDto(
    Guid    ShopId,
    Guid    ProductId,
    string  ProductCode,
    string  ProductName,
    decimal OnHand,
    decimal AvgCost,
    decimal StockValue,
    DateTime? LastMovementAt);
