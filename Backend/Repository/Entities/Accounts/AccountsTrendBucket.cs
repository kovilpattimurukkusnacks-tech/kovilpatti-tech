namespace KovilpattiSnacks.Repository.Entities.Accounts;

/// One trend-chart bucket. `Bucket_Start` is the IST calendar date of the
/// bucket (day / week-start Monday / month-start), per the SP's `date_trunc`.
public class AccountsTrendBucket
{
    public DateOnly Bucket_Start      { get; set; }
    public decimal  Dispatched_Amount { get; set; }
    public decimal  Returns_Amount    { get; set; }
    public decimal  Net_Amount        { get; set; }
    // 12-Jul-2026: Purchased (at Cost) per bucket at purchase_price_snapshot.
    public decimal  Purchase_Amount   { get; set; }
    // 12-Jul-2026 (client): MRP value requested but not sent (stock short).
    public decimal  Shortfall_Amount  { get; set; }
}
