namespace KovilpattiSnacks.Repository.Entities;

/// Godown / inventory-side operating expense (21-Jul-2026, client req).
/// Parallel to <see cref="ShopUtilityExpense"/> — same shape, but scoped
/// to an inventory instead of a shop. Feeds the admin Accounts screen
/// as a separate "Inventory Expenses" line alongside Shop Expenses.
public class InventoryExpense
{
    public Guid     Id           { get; set; }
    public Guid     Inventory_Id { get; set; }
    /// Free text — not an enum. Same autocomplete list as the shop side
    /// (Rent / Electricity / Water / Staff Salary / Maintenance / …).
    public string   Category     { get; set; } = default!;
    public decimal  Amount       { get; set; }
    public string?  Note         { get; set; }
    public DateOnly Expense_Date { get; set; }
    public DateTimeOffset Created_At { get; set; }
    public DateTimeOffset Updated_At { get; set; }
}
