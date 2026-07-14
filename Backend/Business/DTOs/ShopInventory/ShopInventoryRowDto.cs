namespace KovilpattiSnacks.Business.DTOs.ShopInventory;

/// One row on the shop's stock ledger screen. `StockValue = OnHand × AvgCost`
/// pre-computed by the SP (numeric(14,2)).
public record ShopInventoryRowDto(
    Guid    ProductId,
    string  ProductCode,
    string  ProductName,
    string  CategoryName,
    decimal? WeightValue,
    string? WeightUnit,
    decimal Mrp,
    decimal OnHand,
    decimal AvgCost,
    decimal StockValue,
    DateTime? LastMovementAt);
