namespace KovilpattiSnacks.Business.DTOs.ShopInventory;

/// A product below the reorder threshold. Sorted by ascending on_hand in
/// the SP so the most urgent items are first.
public record ShopInventoryLowStockDto(
    Guid    ProductId,
    string  ProductCode,
    string  ProductName,
    decimal OnHand,
    decimal Mrp);
