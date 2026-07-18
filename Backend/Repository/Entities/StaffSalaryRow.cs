namespace KovilpattiSnacks.Repository.Entities;

/// One row per non-admin staff member for a given date range — the rollup
/// fn_staff_salary_get_all returns for the Admin Staff "Salary" tab.
public class StaffSalaryRow
{
    public Guid     Staff_Id       { get; set; }
    public string   Full_Name      { get; set; } = default!;
    public string   Role           { get; set; } = default!;
    public Guid?    Shop_Id        { get; set; }
    public string?  Shop_Name      { get; set; }
    public Guid?    Inventory_Id   { get; set; }
    public string?  Inventory_Name { get; set; }
    public decimal  Monthly_Amount { get; set; }
    public decimal  Paid           { get; set; }
    public decimal  Deducted       { get; set; }
    public decimal  Net            { get; set; }
    /// True for ShopUser staff — their Pay/Deduct entries post to
    /// shop_utility_expenses and are reflected in Admin Accounts. False for
    /// Inventory staff, whose entries are record-keeping only.
    public bool     In_Accounts    { get; set; }
}
