namespace KovilpattiSnacks.Repository.Entities;

/// Single (shop, product) row for the detail drill-down screen.
/// Returned by fn_shop_inventory_get.
public class ShopInventoryDetail
{
    public Guid   Shop_Id           { get; set; }
    public Guid   Product_Id        { get; set; }
    public string Product_Code      { get; set; } = default!;
    public string Product_Name      { get; set; } = default!;
    public decimal On_Hand          { get; set; }
    public decimal Avg_Cost         { get; set; }
    public decimal Stock_Value      { get; set; }
    public DateTime? Last_Movement_At { get; set; }
}
