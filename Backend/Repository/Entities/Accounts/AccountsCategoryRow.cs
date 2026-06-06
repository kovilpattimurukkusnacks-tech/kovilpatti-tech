namespace KovilpattiSnacks.Repository.Entities.Accounts;

/// Per-leaf-category breakdown row from fn_accounts_by_category. Quantity
/// and Amount are signed (Returns subtract) so the category Net reflects
/// the page-level Net KPI.
public class AccountsCategoryRow
{
    public int     Category_Id    { get; set; }
    public string  Category_Path  { get; set; } = default!;
    public long    Quantity       { get; set; }
    public decimal Amount         { get; set; }
}
