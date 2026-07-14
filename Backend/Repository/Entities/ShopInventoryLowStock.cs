namespace KovilpattiSnacks.Repository.Entities;

/// A row where on_hand < threshold. Returned by fn_shop_inventory_low_stock.
/// Drives the reorder alert on the shop dashboard.
public class ShopInventoryLowStock
{
    public Guid    Product_Id    { get; set; }
    public string  Product_Code  { get; set; } = default!;
    public string  Product_Name  { get; set; } = default!;
    public decimal On_Hand       { get; set; }
    public decimal Mrp           { get; set; }
    /// Leaf category id (nullable if the product's category was deleted).
    public int?    Category_Id   { get; set; }
    /// Leaf category name — e.g. "Chips 300".
    public string? Category_Name { get; set; }
    /// Full breadcrumb path — e.g. "1KG Snacks > Chips 300". Populated by
    /// fn_category_list()'s recursive CTE; null if the category is gone.
    public string? Category_Path { get; set; }
}
