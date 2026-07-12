namespace KovilpattiSnacks.Repository.Entities.Accounts;

/// Single-row KPI aggregate mapped from fn_accounts_summary. Property names
/// use PascalCase_With_Underscores so Dapper's case-insensitive map binds
/// them to the SP's snake_case columns.
public class AccountsSummary
{
    public decimal Requested_Amount         { get; set; }
    public decimal Dispatched_Amount        { get; set; }
    public long    Dispatched_Request_Count { get; set; }
    public decimal Returns_Amount           { get; set; }
    public long    Returns_Request_Count    { get; set; }
    public decimal Net_Amount               { get; set; }
    public long    Active_Shop_Count        { get; set; }
    public decimal Adjustments_Amount       { get; set; }
    public long    Adjustments_Count        { get; set; }
    // 12-Jul-2026: Purchased (at Cost) — net dispatched cost at the line's
    // purchase_price_snapshot.
    public decimal Purchase_Amount          { get; set; }
}
