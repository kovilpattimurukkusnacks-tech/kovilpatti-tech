namespace KovilpattiSnacks.Repository.Entities;

/// Standing on-hand row for a (shop, product). Returned by
/// fn_shop_inventory_on_hand — the list read for the shop inventory
/// screen. `Stock_Value = On_Hand × Avg_Cost` computed in the SP.
public class ShopInventoryOnHand
{
    public Guid    Product_Id      { get; set; }
    public string  Product_Code    { get; set; } = default!;
    public string  Product_Name    { get; set; } = default!;
    public string  Category_Name   { get; set; } = default!;
    public decimal? Weight_Value   { get; set; }
    public string? Weight_Unit     { get; set; }
    public decimal Mrp             { get; set; }
    public decimal On_Hand         { get; set; }
    public decimal Avg_Cost        { get; set; }
    public decimal Stock_Value     { get; set; }
    public DateTime? Last_Movement_At { get; set; }
}
