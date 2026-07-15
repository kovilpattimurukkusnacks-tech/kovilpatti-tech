namespace KovilpattiSnacks.Repository.Entities.Accounts;

/// One row per (shop, utility category) returned by
/// fn_accounts_utilities_breakdown. Snake_case names match the SP columns
/// so Dapper's default column mapper binds without a custom map.
public class AccountsUtilityRow
{
    public Guid    Shop_Id       { get; set; }
    public string  Shop_Code     { get; set; } = string.Empty;
    public string  Shop_Name     { get; set; } = string.Empty;
    public string  Category      { get; set; } = string.Empty;
    public decimal Amount        { get; set; }
    public long    Expense_Count { get; set; }
}
