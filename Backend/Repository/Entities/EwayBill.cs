namespace KovilpattiSnacks.Repository.Entities;

/// Phase 5b — one row mapped from fn_eway_bill_get / _list_for_purchase.
/// Same column shape from both SPs so this single entity covers both.
///
/// Only Inbound rows are written today (Phase 5b) — the outbound-parent
/// FK columns (Stock_Request_Id, Bill_Id) come through as NULL until Phase 4's
/// outbound wiring lands.
public class EwayBill
{
    public Guid Id { get; set; }
    public string Eway_Number { get; set; } = default!;
    public DateTimeOffset? Generation_Date { get; set; }
    public string Direction { get; set; } = default!;

    public Guid? Vendor_Purchase_Id { get; set; }
    public Guid? Stock_Request_Id  { get; set; }
    public Guid? Bill_Id           { get; set; }

    public string? Document_Number { get; set; }
    public DateOnly? Document_Date { get; set; }

    public string? From_Gstin      { get; set; }
    public string? From_State_Code { get; set; }
    public string? To_Gstin        { get; set; }
    public string? To_State_Code   { get; set; }

    public string? Transport_Mode   { get; set; }
    public short?  Distance_Km      { get; set; }
    public string? Transporter_Name { get; set; }
    public string? Vehicle_Number   { get; set; }

    public decimal? Taxable_Amount { get; set; }
    public decimal  Cgst_Amount    { get; set; }
    public decimal  Sgst_Amount    { get; set; }
    public decimal  Igst_Amount    { get; set; }
    public decimal? Total_Amount   { get; set; }

    public DateTimeOffset? Valid_From  { get; set; }
    public DateTimeOffset? Valid_Until { get; set; }

    public string Status         { get; set; } = default!;
    public string Generated_Via  { get; set; } = default!;

    public string? Attachment_Url { get; set; }
    public string? Notes          { get; set; }

    public DateTimeOffset Created_At { get; set; }
}
