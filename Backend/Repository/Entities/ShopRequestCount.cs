namespace KovilpattiSnacks.Repository.Entities;

/// One row of the per-shop request-count summary used by the list page's
/// quick-filter chips. Returned by fn_request_count_by_shop.
public class ShopRequestCount
{
    public Guid   Shop_Id        { get; set; }
    public string Shop_Code      { get; set; } = default!;
    public string Shop_Name      { get; set; } = default!;
    public long   Request_Count  { get; set; }
}
