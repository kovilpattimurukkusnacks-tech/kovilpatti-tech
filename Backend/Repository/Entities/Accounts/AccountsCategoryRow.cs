namespace KovilpattiSnacks.Repository.Entities.Accounts;

/// Per-leaf-category breakdown row from fn_accounts_by_category. Quantity
/// and Amount are signed (Returns subtract) so the category Net reflects
/// the page-level Net KPI.
public class AccountsCategoryRow
{
    public int     Category_Id     { get; set; }
    public string  Category_Path   { get; set; } = default!;
    public long    Quantity        { get; set; }
    public decimal Amount          { get; set; }
    // 17-Jun-2026 (client #12): cost-side metrics for the Excel export.
    // Profit / Loss are mutually exclusive — exactly one is non-zero per row.
    public decimal Purchase_Amount { get; set; }
    public decimal Profit          { get; set; }
    public decimal Loss            { get; set; }
    // 19-Jun-2026 (client #13): per-dimension positive aggregates for the
    // FE view-mode lens (Requested / Dispatched / Returns).
    public long    Requested_Qty       { get; set; }
    public long    Dispatched_Qty      { get; set; }
    public long    Returns_Qty         { get; set; }
    public decimal Requested_Amount    { get; set; }
    public decimal Dispatched_Amount   { get; set; }
    public decimal Returns_Amount      { get; set; }
}
