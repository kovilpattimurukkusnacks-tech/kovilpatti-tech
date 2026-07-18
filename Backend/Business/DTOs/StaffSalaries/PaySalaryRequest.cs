namespace KovilpattiSnacks.Business.DTOs.StaffSalaries;

/// Records an actual salary payment. `Mode` (Cash/UPI/Bank Transfer) is
/// folded into the stored note server-side rather than given its own
/// column — this domain has no other use for a payment-mode field yet.
public record PaySalaryRequest(
    Guid     StaffId,
    decimal  Amount,
    string   Mode,
    DateOnly TxnDate,
    string?  Note);
