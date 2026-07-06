namespace KovilpattiSnacks.Repository.Entities;

/// One row of the cumulative pending workload report.
/// Returned by fn_request_pending_cumulative.
public class CumulativePendingLine
{
    public Guid    Product_Id     { get; set; }
    public string  Product_Code   { get; set; } = default!;
    public string  Product_Name   { get; set; } = default!;
    public string  Category_Name  { get; set; } = default!;
    public string  Type           { get; set; } = default!;
    public decimal? Weight_Value  { get; set; }
    public string?  Weight_Unit   { get; set; }
    public long    Total_Qty      { get; set; }
    public long    Order_Qty      { get; set; }
    public long    Special_Qty    { get; set; }
    public long    Request_Count  { get; set; }
}
