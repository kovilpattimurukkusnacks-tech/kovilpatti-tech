namespace KovilpattiSnacks.Repository.Entities.Accounts;

/// One row per (inventory, category) returned by
/// fn_accounts_inventory_expenses_breakdown. Snake_case column names for
/// Dapper's default column mapper. Distinct from AccountsUtilityRow —
/// utility rows scope by shop, inventory-expense rows scope by godown.
public class AccountsInventoryExpenseRow
{
    public Guid    Inventory_Id   { get; set; }
    public string  Inventory_Code { get; set; } = string.Empty;
    public string  Inventory_Name { get; set; } = string.Empty;
    public string  Category       { get; set; } = string.Empty;
    public decimal Amount         { get; set; }
    public long    Expense_Count  { get; set; }
}
