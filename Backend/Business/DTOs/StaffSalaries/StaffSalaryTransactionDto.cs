namespace KovilpattiSnacks.Business.DTOs.StaffSalaries;

/// One row in a staff's Pay/Deduct history — powers the "hover the Net
/// figure" breakdown on the Salary tab. Amount is signed (+Pay / −Deduct).
public record StaffSalaryTransactionDto(
    DateOnly TxnDate,
    decimal  Amount,
    string?  Note);
