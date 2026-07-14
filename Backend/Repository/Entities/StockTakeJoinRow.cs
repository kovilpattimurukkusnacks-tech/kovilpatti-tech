namespace KovilpattiSnacks.Repository.Entities;

/// Flat join row returned by fn_stock_take_get — header columns repeat per
/// item row. Service splits into a session-header DTO + list of item DTOs.
/// LEFT JOIN — a freshly-started take with 0 lines still returns 1 row
/// (item fields all null in that case).
public class StockTakeJoinRow
{
    // Header — repeated per item row
    public Guid    Id           { get; set; }
    public string  Code         { get; set; } = default!;
    public Guid    Shop_Id      { get; set; }
    public string  Status       { get; set; } = default!;
    public DateTime Started_At   { get; set; }
    public DateTime? Submitted_At { get; set; }
    public string? Notes        { get; set; }

    // Item — nullable (session may have 0 lines yet)
    public Guid?   Product_Id   { get; set; }
    public string? Product_Code { get; set; }
    public string? Product_Name { get; set; }
    public decimal? System_Qty  { get; set; }
    public decimal? Counted_Qty { get; set; }
    public decimal? Qty_Diff    { get; set; }
    public string?  Item_Note   { get; set; }
}
