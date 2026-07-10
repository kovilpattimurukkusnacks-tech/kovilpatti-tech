namespace KovilpattiSnacks.Repository.Entities;

/// A row where on_hand < threshold. Returned by fn_shop_inventory_low_stock.
/// Drives the reorder alert on the shop dashboard.
public class ShopInventoryLowStock
{
    public Guid   Product_Id   { get; set; }
    public string Product_Code { get; set; } = default!;
    public string Product_Name { get; set; } = default!;
    public decimal On_Hand     { get; set; }
    public decimal Mrp         { get; set; }
}
