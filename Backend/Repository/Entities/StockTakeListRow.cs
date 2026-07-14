namespace KovilpattiSnacks.Repository.Entities;

/// One row in the stock-take history list per shop. Returned by
/// fn_stock_take_list. Rollups are computed in-SP:
///
///   Item_Count   — lines with a non-null qty_diff
///   Diff_Count   — lines where counted_qty <> system_qty
///   Net_Diff_Qty — signed sum of qty_diff across all lines (sanity signal —
///                  huge net magnitude means either miscounted or genuine
///                  shrinkage)
public class StockTakeListRow
{
    public Guid    Id           { get; set; }
    public string  Code         { get; set; } = default!;
    public string  Status       { get; set; } = default!;   // Draft / Submitted / Cancelled
    public DateTime Started_At   { get; set; }
    public DateTime? Submitted_At { get; set; }
    public long    Item_Count   { get; set; }
    public long    Diff_Count   { get; set; }
    public decimal Net_Diff_Qty { get; set; }
}
