namespace KovilpattiSnacks.Repository.Entities.Accounts;

/// Top-N product row from fn_accounts_top_products. Quantity / Amount are
/// signed (Returns subtract) so the same row reflects net movement.
public class AccountsProductRow
{
    public Guid     Product_Id   { get; set; }
    public string   Product_Code { get; set; } = default!;
    public string   Product_Name { get; set; } = default!;
    public decimal? Weight_Value { get; set; }
    public string?  Weight_Unit  { get; set; }
    public long     Quantity     { get; set; }
    public decimal  Amount       { get; set; }
    // 19-Jun-2026 (client #13): per-dimension positive aggregates for the
    // FE view-mode lens (Requested / Dispatched / Returns).
    public long     Requested_Qty       { get; set; }
    public long     Dispatched_Qty      { get; set; }
    public long     Returns_Qty         { get; set; }
    public decimal  Requested_Amount    { get; set; }
    public decimal  Dispatched_Amount   { get; set; }
    public decimal  Returns_Amount      { get; set; }
}
