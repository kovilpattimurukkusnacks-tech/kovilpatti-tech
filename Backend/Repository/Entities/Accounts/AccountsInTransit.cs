namespace KovilpattiSnacks.Repository.Entities.Accounts;

/// Single-row summary from fn_accounts_in_transit. Independent of any date
/// range — represents the "money currently in-transit" instant.
public class AccountsInTransit
{
    public long            Request_Count        { get; set; }
    public decimal         Total_Amount         { get; set; }
    /// Null when Request_Count is 0.
    public DateTimeOffset? Oldest_Dispatched_At { get; set; }
    /// Subset of Request_Count that are shop-declared Special Requests.
    /// Never exceeds Request_Count. 0 when none in transit are special.
    public long            Special_Count        { get; set; }
    /// Sum of total_amount over the Special-only subset. 0 when Special_Count is 0.
    public decimal         Special_Amount       { get; set; }
}
