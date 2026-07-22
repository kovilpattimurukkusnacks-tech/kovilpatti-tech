namespace KovilpattiSnacks.Repository.Entities;

/// One row in a staff's Pay/Deduct history (fn_staff_salary_transactions_list)
/// — sourced from either shop_utility_expenses or
/// staff_salary_other_transactions depending on the staff's role, unioned
/// into one signed, dated shape.
public class StaffSalaryTransaction
{
    public DateOnly Txn_Date { get; set; }
    public decimal  Amount   { get; set; }
    public string?  Note     { get; set; }
}
