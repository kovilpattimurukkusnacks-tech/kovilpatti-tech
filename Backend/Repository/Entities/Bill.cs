namespace KovilpattiSnacks.Repository.Entities;

/// Product row for the POS billing screen — fn_billing_products.
/// On_Hand is 0 for products the shop has never held.
public class BillingProduct
{
    public Guid     Id           { get; set; }
    public string   Code         { get; set; } = default!;
    public string?  Barcode      { get; set; }
    public string   Name         { get; set; } = default!;
    public decimal? Weight_Value { get; set; }
    public string?  Weight_Unit  { get; set; }
    public decimal  Mrp          { get; set; }
    public decimal  On_Hand      { get; set; }
}

/// Row returned by fn_bill_create — the freshly issued bill's identity + totals.
public class BillCreated
{
    public Guid    Id           { get; set; }
    public string  Code         { get; set; } = default!;
    public int     Total_Items  { get; set; }
    public int     Total_Qty    { get; set; }
    public decimal Total_Amount { get; set; }
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
    public decimal   Total_Amount    { get; set; }
    public DateTime  Created_At      { get; set; }
    public string?   Created_By_Name { get; set; }
    public DateTime? Cancelled_At    { get; set; }
    public string?   Cancel_Reason   { get; set; }
    public long      Total_Count     { get; set; }
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
    public decimal   Total_Amount      { get; set; }
    public string?   Notes             { get; set; }
    public DateTime  Created_At        { get; set; }
    public string?   Created_By_Name   { get; set; }
    public DateTime? Cancelled_At      { get; set; }
    public string?   Cancelled_By_Name { get; set; }
    public string?   Cancel_Reason     { get; set; }
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
    public int      Qty          { get; set; }
    public decimal  Unit_Price   { get; set; }
    public decimal  Line_Total   { get; set; }
}
