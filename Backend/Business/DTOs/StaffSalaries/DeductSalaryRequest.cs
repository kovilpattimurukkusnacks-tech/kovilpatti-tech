namespace KovilpattiSnacks.Business.DTOs.StaffSalaries;

/// Records a deduction / advance-recovery against a staff member's salary
/// for the given month — stored as a negative amount so it nets against
/// Pay entries in both the Salary tab and (for ShopUser staff) Accounts.
public record DeductSalaryRequest(
    Guid     StaffId,
    decimal  Amount,
    string   Reason,
    DateOnly TxnDate,
    string?  Note);
