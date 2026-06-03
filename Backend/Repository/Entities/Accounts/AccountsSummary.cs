namespace KovilpattiSnacks.Repository.Entities.Accounts;

/// Single-row KPI aggregate mapped from fn_accounts_summary. Property names
/// use PascalCase_With_Underscores so Dapper's case-insensitive map binds
/// them to the SP's snake_case columns.
public class AccountsSummary
{
    public decimal Dispatched_Amount        { get; set; }
    public long    Dispatched_Request_Count { get; set; }
    public decimal Returns_Amount           { get; set; }
    public long    Returns_Request_Count    { get; set; }
    public decimal Net_Amount               { get; set; }
    public long    Active_Shop_Count        { get; set; }
    public decimal Adjustments_Amount       { get; set; }
    public long    Adjustments_Count        { get; set; }
}
