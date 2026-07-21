namespace KovilpattiSnacks.Repository.Entities;

/// Pay/Deduct history for Inventory-role staff (no shop_id, so it can't live
/// in shop_utility_expenses) — record-keeping only, never read by Accounts.
public class StaffSalaryOtherTransaction
{
    public Guid     Id         { get; set; }
    public Guid     Staff_Id   { get; set; }
    public decimal  Amount     { get; set; }
    public string?  Reason     { get; set; }
    public string?  Note       { get; set; }
    public DateOnly Txn_Date   { get; set; }
    public DateTimeOffset Created_At { get; set; }
    public DateTimeOffset Updated_At { get; set; }
}
