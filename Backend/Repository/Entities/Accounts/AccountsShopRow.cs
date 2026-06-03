namespace KovilpattiSnacks.Repository.Entities.Accounts;

/// Per-shop breakdown row from fn_accounts_by_shop.
public class AccountsShopRow
{
    public Guid    Shop_Id              { get; set; }
    public string  Shop_Code            { get; set; } = default!;
    public string  Shop_Name            { get; set; } = default!;
    public long    Order_Request_Count  { get; set; }
    public long    Return_Request_Count { get; set; }
    public long    Dispatched_Qty       { get; set; }
    public decimal Dispatched_Amount    { get; set; }
    public decimal Returns_Amount       { get; set; }
    public decimal Net_Amount           { get; set; }
}
