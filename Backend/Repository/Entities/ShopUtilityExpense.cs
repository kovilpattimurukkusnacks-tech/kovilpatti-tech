namespace KovilpattiSnacks.Repository.Entities;

public class ShopUtilityExpense
{
    public Guid     Id           { get; set; }
    public Guid     Shop_Id      { get; set; }
    /// Free text — not an enum. The FE offers a suggested list via a
    /// free-typing Autocomplete; an unrecognised value is still stored as-is.
    public string   Category     { get; set; } = default!;
    public decimal  Amount       { get; set; }
    public string?  Note         { get; set; }
    public DateOnly Expense_Date { get; set; }
    public DateTimeOffset Created_At { get; set; }
    public DateTimeOffset Updated_At { get; set; }
}
