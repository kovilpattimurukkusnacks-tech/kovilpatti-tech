namespace KovilpattiSnacks.Repository.Entities;

/// Phase 4c — fn_eod_expected snapshot for a shop over a window.
public class EodExpected
{
    public decimal Cash_Sales       { get; set; }
    public decimal Upi_Sales        { get; set; }
    public decimal Credit_Sales     { get; set; }
    public decimal Cash_Refunds     { get; set; }
    public decimal Upi_Refunds      { get; set; }
    public decimal Cancel_Cash_Back { get; set; }
    public decimal Expected_Cash    { get; set; }
    public long    Bill_Count       { get; set; }
    public long    Return_Count     { get; set; }
    public long    Cancel_Count     { get; set; }
}

/// Phase 4c — one row from fn_eod_list.
public class CashSessionListRow
{
    public Guid           Id                { get; set; }
    public DateTimeOffset Window_From       { get; set; }
    public DateTimeOffset Closed_At         { get; set; }
    public string?        Closed_By_Name    { get; set; }
    public decimal        Cash_Sales        { get; set; }
    public decimal        Upi_Sales         { get; set; }
    public decimal        Credit_Sales      { get; set; }
    public decimal        Cash_Refunds      { get; set; }
    public decimal        Upi_Refunds       { get; set; }
    public decimal        Cancel_Cash_Back  { get; set; }
    public decimal        Expected_Cash     { get; set; }
    public decimal        Physical_Cash     { get; set; }
    public decimal        Variance          { get; set; }
    public string?        Notes             { get; set; }
}
