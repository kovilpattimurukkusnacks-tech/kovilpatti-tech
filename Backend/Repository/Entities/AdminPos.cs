namespace KovilpattiSnacks.Repository.Entities;

// Phase 4d (25-Sep-2026) — rows from the admin-side POS readers in
// DB/phase4/phase4_pos_admin_procedures.sql. Shop-agnostic: every row
// carries its owning shop. Total_Count is the window COUNT(*) on list SPs.

/// fn_admin_bill_list
public class AdminBillListRow
{
    public Guid      Id                 { get; set; }
    public string    Code               { get; set; } = default!;
    public Guid      Shop_Id            { get; set; }
    public string    Shop_Code          { get; set; } = default!;
    public string    Shop_Name          { get; set; } = default!;
    public string    Status             { get; set; } = default!;
    public string    Payment_Mode       { get; set; } = default!;
    public int       Total_Items        { get; set; }
    public int       Total_Qty          { get; set; }
    public decimal   Subtotal           { get; set; }
    public decimal   Discount_Amount    { get; set; }
    public decimal   Total_Amount       { get; set; }
    public decimal   Returned_Amount    { get; set; }
    public string?   Customer_Name      { get; set; }
    public string?   Customer_Phone     { get; set; }
    public DateTime  Created_At         { get; set; }
    public string?   Created_By_Name    { get; set; }
    public DateTime? Cancelled_At       { get; set; }
    public string?   Cancelled_By_Name  { get; set; }
    public string?   Cancel_Reason_Type { get; set; }
    public string?   Cancel_Reason      { get; set; }
    public long      Total_Count        { get; set; }
}

/// fn_admin_bill_get — BillHeader plus the owning shop.
public class AdminBillHeader : BillHeader
{
    public Guid   Shop_Id   { get; set; }
    public string Shop_Code { get; set; } = default!;
    public string Shop_Name { get; set; } = default!;
}

/// fn_admin_bill_return_list
public class AdminBillReturnListRow
{
    public Guid     Id               { get; set; }
    public string   Code             { get; set; } = default!;
    public Guid     Shop_Id          { get; set; }
    public string   Shop_Code        { get; set; } = default!;
    public string   Shop_Name        { get; set; } = default!;
    public Guid     Source_Bill_Id   { get; set; }
    public string   Source_Bill_Code { get; set; } = default!;
    public string   Refund_Mode      { get; set; } = default!;
    public string   Reason_Type      { get; set; } = default!;
    public string?  Reason_Note      { get; set; }
    public int      Total_Items      { get; set; }
    public int      Total_Qty        { get; set; }
    public decimal  Total_Amount     { get; set; }
    public DateTime Created_At       { get; set; }
    public string?  Created_By_Name  { get; set; }
    public long     Total_Count      { get; set; }
}

/// fn_admin_bill_return_get — BillReturnHeader plus the owning shop.
public class AdminBillReturnHeader : BillReturnHeader
{
    public Guid   Shop_Id   { get; set; }
    public string Shop_Code { get; set; } = default!;
    public string Shop_Name { get; set; } = default!;
}

/// fn_admin_eod_list
public class AdminEodRow
{
    public Guid     Id               { get; set; }
    public Guid     Shop_Id          { get; set; }
    public string   Shop_Code        { get; set; } = default!;
    public string   Shop_Name        { get; set; } = default!;
    public DateTime Window_From      { get; set; }
    public DateTime Closed_At        { get; set; }
    public string?  Closed_By_Name   { get; set; }
    public decimal  Cash_Sales       { get; set; }
    public decimal  Upi_Sales        { get; set; }
    public decimal  Credit_Sales     { get; set; }
    public decimal  Cash_Refunds     { get; set; }
    public decimal  Upi_Refunds      { get; set; }
    public decimal  Cancel_Cash_Back { get; set; }
    public decimal  Cancel_Upi_Back  { get; set; }
    public decimal  Cash_Settlements { get; set; }
    public decimal  Upi_Settlements  { get; set; }
    public decimal  Expected_Cash    { get; set; }
    public decimal  Physical_Cash    { get; set; }
    public decimal  Variance         { get; set; }
    public string?  Notes            { get; set; }
    public long     Total_Count      { get; set; }
}

/// fn_admin_eod_denominations
public class AdminEodDenominationRow
{
    public int     Denomination { get; set; }
    public int     Count        { get; set; }
    public decimal Amount       { get; set; }
}

/// fn_admin_customer_list
public class AdminCustomerRow
{
    public Guid      Id                 { get; set; }
    public string    Code               { get; set; } = default!;
    public Guid      Shop_Id            { get; set; }
    public string    Shop_Code          { get; set; } = default!;
    public string    Shop_Name          { get; set; } = default!;
    public string    Name               { get; set; } = default!;
    public string    Phone              { get; set; } = default!;
    public decimal   Credit_Limit       { get; set; }
    public decimal   Credit_Balance     { get; set; }
    public DateTime? Last_Credit_At     { get; set; }
    public DateTime? Last_Settlement_At { get; set; }
    public DateTime  Created_At         { get; set; }
    public decimal   Total_Outstanding  { get; set; }
    public long      Total_Count        { get; set; }
}

/// fn_admin_sales_summary — one row.
public class AdminSalesSummary
{
    public long    Bill_Count       { get; set; }
    public decimal Gross_Sales      { get; set; }
    public decimal Discount_Total   { get; set; }
    public decimal Sales_Total      { get; set; }
    public decimal Avg_Bill_Value   { get; set; }
    public long    Cancelled_Count  { get; set; }
    public decimal Cancelled_Amount { get; set; }
    public long    Return_Count     { get; set; }
    public decimal Returns_Total    { get; set; }
    public decimal Net_Sales        { get; set; }
    public decimal Cash_Sales       { get; set; }
    public decimal Upi_Sales        { get; set; }
    public decimal Credit_Sales     { get; set; }
    public decimal Cash_Refunds     { get; set; }
    public decimal Upi_Refunds      { get; set; }
    public decimal Settlements_Cash { get; set; }
    public decimal Settlements_Upi  { get; set; }
}

/// fn_admin_sales_by_shop
public class AdminSalesShopRow
{
    public Guid    Shop_Id          { get; set; }
    public string  Shop_Code        { get; set; } = default!;
    public string  Shop_Name        { get; set; } = default!;
    public long    Bill_Count       { get; set; }
    public decimal Sales_Total      { get; set; }
    public decimal Discount_Total   { get; set; }
    public decimal Returns_Total    { get; set; }
    public decimal Net_Sales        { get; set; }
    public long    Cancelled_Count  { get; set; }
    public decimal Cancelled_Amount { get; set; }
    public decimal Cash_Sales       { get; set; }
    public decimal Upi_Sales        { get; set; }
    public decimal Credit_Sales     { get; set; }
}

/// fn_admin_sales_daily
public class AdminSalesDayRow
{
    public DateOnly Day             { get; set; }
    public long     Bill_Count      { get; set; }
    public decimal  Sales_Total     { get; set; }
    public decimal  Returns_Total   { get; set; }
    public decimal  Net_Sales       { get; set; }
    public long     Cancelled_Count { get; set; }
    public decimal  Cash_Sales      { get; set; }
    public decimal  Upi_Sales       { get; set; }
    public decimal  Credit_Sales    { get; set; }
}

/// fn_admin_sales_top_products
public class AdminSalesProductRow
{
    public Guid    Product_Id     { get; set; }
    public string  Product_Code   { get; set; } = default!;
    public string  Product_Name   { get; set; } = default!;
    public string? Category_Name  { get; set; }
    public long    Packets_Sold   { get; set; }
    public decimal Loose_Weight_G { get; set; }
    public long    Bill_Count     { get; set; }
    public decimal Revenue        { get; set; }
}

/// fn_shop_inventory_import_opening — one row per input line.
public class OpeningImportRow
{
    public int      Row_No       { get; set; }
    public string   Input_Code   { get; set; } = default!;
    public Guid?    Product_Id   { get; set; }
    public string?  Product_Code { get; set; }
    public string?  Product_Name { get; set; }
    public decimal? Current_Qty  { get; set; }
    public decimal  New_Qty      { get; set; }
    public decimal? Delta        { get; set; }
    public string   Status       { get; set; } = default!;
    public string?  Message      { get; set; }
}
