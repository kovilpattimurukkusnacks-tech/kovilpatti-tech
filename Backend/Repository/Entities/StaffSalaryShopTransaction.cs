namespace KovilpattiSnacks.Repository.Entities;

/// Row shape returned by fn_staff_salary_shop_txn_create — this is really a
/// shop_utility_expenses row (category always 'Staff Salary', staff_id set),
/// so a ShopUser staff's Pay/Deduct entries flow through
/// fn_accounts_utilities_breakdown() automatically. See ShopUtilityExpense.
public class StaffSalaryShopTransaction
{
    public Guid     Id           { get; set; }
    public Guid     Shop_Id      { get; set; }
    public Guid     Staff_Id     { get; set; }
    public string   Category     { get; set; } = default!;
    public decimal  Amount       { get; set; }
    public string?  Note         { get; set; }
    public DateOnly Expense_Date { get; set; }
    public DateTimeOffset Created_At { get; set; }
    public DateTimeOffset Updated_At { get; set; }
}
