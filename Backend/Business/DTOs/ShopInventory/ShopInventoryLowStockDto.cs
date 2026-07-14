namespace KovilpattiSnacks.Business.DTOs.ShopInventory;

/// A product below the reorder threshold. Sorted by ascending on_hand in
/// the SP so the most urgent items are first. Category name + full
/// breadcrumb path travel alongside so the dashboard can show WHERE the
/// low item sits without a second lookup.
public record ShopInventoryLowStockDto(
    Guid    ProductId,
    string  ProductCode,
    string  ProductName,
    decimal OnHand,
    decimal Mrp,
    int?    CategoryId,
    string? CategoryName,        // leaf, e.g. "Chips 300"
    string? CategoryPath);       // full breadcrumb, e.g. "1KG Snacks > Chips 300"
