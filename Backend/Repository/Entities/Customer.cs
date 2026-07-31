namespace KovilpattiSnacks.Repository.Entities;

/// Customer row — fn_customer_lookup / create / list (features #6 + #4).
/// Created_At + Total_Count are only populated by the list SP.
public class Customer
{
    public Guid      Id             { get; set; }
    public string    Code           { get; set; } = default!;
    public string    Name           { get; set; } = default!;
    public string    Phone          { get; set; } = default!;
    public decimal   Credit_Limit   { get; set; }
    public decimal   Credit_Balance { get; set; }
    public DateTime? Created_At     { get; set; }
    public long      Total_Count    { get; set; }
}

/// A row from fn_customer_credit_ledger_list.
public class CustomerCreditLedgerRow
{
    public Guid      Id              { get; set; }
    public string    Entry_Type      { get; set; } = default!;
    public decimal   Amount          { get; set; }
    public string?   Mode            { get; set; }
    public string?   Note            { get; set; }
    public decimal   Balance_After   { get; set; }
    public string?   Bill_Code       { get; set; }
    public DateTime  Created_At      { get; set; }
    public string?   Created_By_Name { get; set; }
    public long      Total_Count     { get; set; }
}
