namespace KovilpattiSnacks.Business.DTOs.ShopInventory;

/// Slim row for the "Inventory by Category" tree on the shop dashboard.
/// FE groups by `CategoryId` and rolls up `OnHand` through the category
/// tree fetched separately via /api/categories. No pagination — the tree
/// shows the whole catalog.
public record ShopInventoryTreeItemDto(
    Guid    ProductId,
    string  ProductCode,
    string  ProductName,
    int     CategoryId,
    decimal OnHand,
    decimal Mrp);
