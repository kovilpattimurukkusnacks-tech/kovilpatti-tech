namespace KovilpattiSnacks.Repository.Entities.Accounts;

/// One row per inventory returned by
/// fn_accounts_godown_expenses_by_inventory — the per-godown staff-salary
/// (Pay/Deduct) rollup for the admin "By Godown" panel. Snake_case names
/// so Dapper's default column mapper binds without a custom map.
public class AccountsGodownExpenseByInventoryRow
{
    public Guid    Inventory_Id   { get; set; }
    public string  Inventory_Code { get; set; } = string.Empty;
    public string  Inventory_Name { get; set; } = string.Empty;
    public decimal Amount         { get; set; }
}
