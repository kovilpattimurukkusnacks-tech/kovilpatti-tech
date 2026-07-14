namespace KovilpattiSnacks.Repository.Entities;

/// Slim row for the dashboard's category-tree browse view. Returned by
/// fn_shop_inventory_tree. Category rollups happen client-side using the
/// existing categories tree.
public class ShopInventoryTreeItem
{
    public Guid   Product_Id   { get; set; }
    public string Product_Code { get; set; } = default!;
    public string Product_Name { get; set; } = default!;
    public int    Category_Id  { get; set; }
    public decimal On_Hand     { get; set; }
    public decimal Mrp         { get; set; }
}
