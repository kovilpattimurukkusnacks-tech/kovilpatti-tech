namespace KovilpattiSnacks.Repository.Entities;

/// Product row for the POS billing screen — fn_billing_products.
/// On_Hand is 0 for products the shop has never held.
public class BillingProduct
{
    public Guid     Id            { get; set; }
    public string   Code          { get; set; } = default!;
    public string?  Barcode       { get; set; }
    public string   Name          { get; set; } = default!;
    public string?  Category_Name { get; set; }
    public decimal? Weight_Value  { get; set; }
    public string?  Weight_Unit   { get; set; }
    public decimal  Mrp           { get; set; }
    public decimal  On_Hand       { get; set; }
    /// 01-Aug-2026 (Phase 4c): admin toggle. When true the POS lets the
    /// cashier pick a weight (g/kg) instead of a packet count.
    public bool     Sold_Loose    { get; set; }
}

/// Row returned by fn_bill_create — the freshly issued bill's identity + totals.
/// 01-Aug-2026: Subtotal + Discount_Amount added; Total_Amount is post-discount.
public class BillCreated
{
    public Guid    Id              { get; set; }
    public string  Code            { get; set; } = default!;
    public int     Total_Items     { get; set; }
    public int     Total_Qty       { get; set; }
    public decimal Subtotal        { get; set; }
    public decimal Discount_Amount { get; set; }
    public decimal Total_Amount    { get; set; }
}

/// List row from fn_bill_list. Total_Count is the window COUNT(*) — same
/// value on every row of the page.
public class BillListRow
{
    public Guid      Id              { get; set; }
    public string    Code            { get; set; } = default!;
    public string    Status          { get; set; } = default!;
    public string    Payment_Mode    { get; set; } = default!;
    public int       Total_Items     { get; set; }
    public int       Total_Qty       { get; set; }
    public decimal   Subtotal        { get; set; }
    public decimal   Discount_Amount { get; set; }
    public decimal   Total_Amount    { get; set; }
    public DateTime  Created_At         { get; set; }
    public string?   Created_By_Name    { get; set; }
    public DateTime? Cancelled_At       { get; set; }
    public string?   Cancel_Reason_Type { get; set; }
    public string?   Cancel_Reason      { get; set; }
    public long      Total_Count        { get; set; }
}

/// Header from fn_bill_get.
public class BillHeader
{
    public Guid      Id                { get; set; }
    public string    Code              { get; set; } = default!;
    public string    Status            { get; set; } = default!;
    public string    Payment_Mode      { get; set; } = default!;
    public int       Total_Items       { get; set; }
    public int       Total_Qty         { get; set; }
    public decimal   Subtotal          { get; set; }
    public string?   Discount_Kind     { get; set; }
    public decimal?  Discount_Value    { get; set; }
    public decimal   Discount_Amount   { get; set; }
    public decimal   Total_Amount      { get; set; }
    public string?   Notes             { get; set; }
    public DateTime  Created_At         { get; set; }
    public string?   Created_By_Name    { get; set; }
    public DateTime? Cancelled_At       { get; set; }
    public string?   Cancelled_By_Name  { get; set; }
    public string?   Cancel_Reason_Type { get; set; }
    public string?   Cancel_Reason      { get; set; }
    public Guid?     Customer_Id        { get; set; }
    public string?   Customer_Name      { get; set; }
    public string?   Customer_Phone     { get; set; }
}

/// Tender row from fn_bill_get_payments (feature #5, split payment).
public class BillPaymentRow
{
    public Guid    Id     { get; set; }
    public string  Mode   { get; set; } = default!;
    public decimal Amount { get; set; }
}

/// Line from fn_bill_get_items.
public class BillItemRow
{
    public Guid     Id           { get; set; }
    public Guid     Product_Id   { get; set; }
    public string   Product_Code { get; set; } = default!;
    public string   Product_Name { get; set; } = default!;
    public decimal? Weight_Value { get; set; }
    public string?  Weight_Unit  { get; set; }
    /// Nullable now — populated only for packet-mode lines.
    public int?     Qty          { get; set; }
    /// 01-Aug-2026 (Phase 4c): populated for loose-weight lines (XOR Qty).
    public decimal? Loose_Weight_G          { get; set; }
    /// Pack weight in grams captured at sale time. Only set for loose lines.
    public decimal? Pack_Weight_G_Snapshot  { get; set; }
    public decimal  Unit_Price   { get; set; }
    public decimal  Line_Total   { get; set; }
}

// ───────── Bill returns (feature #1) ─────────

/// Per-line returnable qty for a bill — fn_bill_returnable_items.
public class BillReturnableItem
{
    public Guid     Product_Id     { get; set; }
    public string   Product_Code   { get; set; } = default!;
    public string   Product_Name   { get; set; } = default!;
    public decimal? Weight_Value   { get; set; }
    public string?  Weight_Unit    { get; set; }
    public decimal  Unit_Price     { get; set; }
    public int      Billed_Qty     { get; set; }
    public int      Returned_Qty   { get; set; }
    public int      Returnable_Qty { get; set; }
}

/// Row returned by fn_bill_return_create — the created return's identity + totals.
public class BillReturnCreated
{
    public Guid    Id           { get; set; }
    public string  Code         { get; set; } = default!;
    public int     Total_Items  { get; set; }
    public int     Total_Qty    { get; set; }
    public decimal Total_Amount { get; set; }
}

/// List row from fn_bill_return_list. Total_Count is the window COUNT(*).
public class BillReturnListRow
{
    public Guid     Id                { get; set; }
    public string   Code              { get; set; } = default!;
    public Guid     Source_Bill_Id    { get; set; }
    public string   Source_Bill_Code  { get; set; } = default!;
    public string   Refund_Mode       { get; set; } = default!;
    public string   Reason_Type       { get; set; } = default!;
    public string?  Reason_Note       { get; set; }
    public int      Total_Items       { get; set; }
    public int      Total_Qty         { get; set; }
    public decimal  Total_Amount      { get; set; }
    public DateTime Created_At        { get; set; }
    public string?  Created_By_Name   { get; set; }
    public long     Total_Count       { get; set; }
}

/// Header from fn_bill_return_get.
public class BillReturnHeader
{
    public Guid     Id                { get; set; }
    public string   Code              { get; set; } = default!;
    public Guid     Source_Bill_Id    { get; set; }
    public string   Source_Bill_Code  { get; set; } = default!;
    public string   Refund_Mode       { get; set; } = default!;
    public string   Reason_Type       { get; set; } = default!;
    public string?  Reason_Note       { get; set; }
    public int      Total_Items       { get; set; }
    public int      Total_Qty         { get; set; }
    public decimal  Total_Amount      { get; set; }
    public DateTime Created_At        { get; set; }
    public string?  Created_By_Name   { get; set; }
}

/// Line from fn_bill_return_get_items — same shape as BillItemRow.
public class BillReturnItemRow
{
    public Guid     Id           { get; set; }
    public Guid     Product_Id   { get; set; }
    public string   Product_Code { get; set; } = default!;
    public string   Product_Name { get; set; } = default!;
    public decimal? Weight_Value { get; set; }
    public string?  Weight_Unit  { get; set; }
    public int      Qty          { get; set; }
    public decimal  Unit_Price   { get; set; }
    public decimal  Line_Total   { get; set; }
}
