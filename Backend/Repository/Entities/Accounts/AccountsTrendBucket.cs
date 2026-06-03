namespace KovilpattiSnacks.Repository.Entities.Accounts;

/// One trend-chart bucket. `Bucket_Start` is the IST calendar date of the
/// bucket (day / week-start Monday / month-start), per the SP's `date_trunc`.
public class AccountsTrendBucket
{
    public DateOnly Bucket_Start      { get; set; }
    public decimal  Dispatched_Amount { get; set; }
    public decimal  Returns_Amount    { get; set; }
    public decimal  Net_Amount        { get; set; }
}
