namespace KovilpattiSnacks.Repository.Entities;

// Phase 4c — held (draft) bills (feature #3).

/// Row from fn_bill_hold_list.
public class HeldBillListRow
{
    public Guid      Id            { get; set; }
    public string?   Label         { get; set; }
    public string?   Note          { get; set; }
    public string?   Customer_Name { get; set; }
    public int       Item_Count    { get; set; }
    public int       Total_Qty     { get; set; }
    public decimal   Total_Amount  { get; set; }
    public DateTime  Created_At    { get; set; }
}

/// Header from fn_bill_hold_get.
public class HeldBillHeader
{
    public Guid    Id          { get; set; }
    public Guid?   Customer_Id { get; set; }
    public string? Label       { get; set; }
    public string? Note        { get; set; }
}

/// Item from fn_bill_hold_get_items — current product data + held qty.
public class HeldBillItemRow
{
    public Guid     Id           { get; set; }   // product id
    public string   Code         { get; set; } = default!;
    public string?  Barcode      { get; set; }
    public string   Name         { get; set; } = default!;
    public decimal? Weight_Value { get; set; }
    public string?  Weight_Unit  { get; set; }
    public decimal  Mrp          { get; set; }
    public decimal  On_Hand      { get; set; }
    public int      Qty          { get; set; }
}
