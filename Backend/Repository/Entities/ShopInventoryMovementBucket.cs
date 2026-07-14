namespace KovilpattiSnacks.Repository.Entities;

/// Movement rollup for a shop over a date range, bucketed by movement_type.
/// Returned by fn_shop_inventory_movement_summary. Powers the "today's
/// receipts / sales / adjustments" cards on the dashboard.
public class ShopInventoryMovementBucket
{
    public string  Movement_Type { get; set; } = default!;
    public decimal Total_Qty     { get; set; }
    public long    Total_Lines   { get; set; }
    public decimal Total_Value   { get; set; }
}
