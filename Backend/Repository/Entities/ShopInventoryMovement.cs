namespace KovilpattiSnacks.Repository.Entities;

/// One row from the shop_inventory_movements ledger, joined with product +
/// actor names. Returned by fn_shop_inventory_movements.
///
///   Movement_Type: Opening / Receipt / Sale / Return / Adjustment / Refund
///   Ref_Type:      Opening / StockRequest / Bill / StockTake /
///                  ManualAdjustment / BillReturn
public class ShopInventoryMovement
{
    public Guid   Id                { get; set; }
    public Guid   Product_Id        { get; set; }
    public string Product_Code      { get; set; } = default!;
    public string Product_Name      { get; set; } = default!;
    public string Movement_Type     { get; set; } = default!;
    public decimal Qty_Delta        { get; set; }
    public decimal Qty_After        { get; set; }
    public decimal? Unit_Cost       { get; set; }
    public string Ref_Type          { get; set; } = default!;
    public Guid?  Ref_Id            { get; set; }
    public string? Note             { get; set; }
    public DateTime Created_At      { get; set; }
    public Guid?  Created_By        { get; set; }
    /// Populated via LEFT JOIN with users.full_name — null if the user
    /// account has been deleted since the movement was written.
    public string? Created_By_Name  { get; set; }
}
