namespace KovilpattiSnacks.Repository.Entities.Accounts;

/// One qty-audit row from fn_accounts_adjustments. Delta_Amount uses the
/// line's UNIT_PRICE snapshot (not the product's current MRP) so historical
/// economics are stable.
public class AccountsAdjustmentRow
{
    public Guid           Audit_Id        { get; set; }
    public DateTimeOffset Edited_At       { get; set; }
    public Guid           Request_Id      { get; set; }
    public string         Request_Code    { get; set; } = default!;
    /// 'Order' or 'Return'. Added 19-Jun-2026 (client #13) so FE can filter
    /// audits by view-mode lens.
    public string         Request_Type    { get; set; } = default!;
    /// Shop-declared Special Request flag on the parent request. Powers
    /// the amber "Special" chip beside the request code on the audit log.
    public bool           Is_Special      { get; set; }
    /// User-supplied label ("Diwali stock 2026"). NULL when Is_Special
    /// is false or the shop left it blank. Chip renders "Special" then.
    public string?        Special_Label   { get; set; }
    public Guid           Shop_Id         { get; set; }
    public string         Shop_Name       { get; set; } = default!;
    public Guid           Product_Id      { get; set; }
    public string         Product_Name    { get; set; } = default!;
    public decimal?       Weight_Value    { get; set; }
    public string?        Weight_Unit     { get; set; }
    public int?           Old_Qty         { get; set; }
    public int?           New_Qty         { get; set; }
    public int            Delta_Qty       { get; set; }
    public decimal        Unit_Price      { get; set; }
    public decimal        Delta_Amount    { get; set; }
    public string?        Reason          { get; set; }
    public Guid?          Edited_By_Id    { get; set; }
    public string?        Edited_By_Name  { get; set; }
}
