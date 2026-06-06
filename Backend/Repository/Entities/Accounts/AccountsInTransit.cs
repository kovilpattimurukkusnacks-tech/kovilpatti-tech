namespace KovilpattiSnacks.Repository.Entities.Accounts;

/// Single-row summary from fn_accounts_in_transit. Independent of any date
/// range — represents the "money currently in-transit" instant.
public class AccountsInTransit
{
    public long            Request_Count        { get; set; }
    public decimal         Total_Amount         { get; set; }
    /// Null when Request_Count is 0.
    public DateTimeOffset? Oldest_Dispatched_At { get; set; }
}
