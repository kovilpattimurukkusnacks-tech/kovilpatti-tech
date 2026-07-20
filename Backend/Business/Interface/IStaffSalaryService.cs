using KovilpattiSnacks.Business.DTOs.StaffSalaries;

namespace KovilpattiSnacks.Business.Interface;

public interface IStaffSalaryService
{
    /// One row per non-admin staff member with paid/deducted/net for the
    /// given range. Admin-only, not scoped to a shop.
    Task<IReadOnlyList<StaffSalaryRowDto>> ListAsync(DateOnly from, DateOnly to, CancellationToken ct = default);

    Task<StaffSalaryDto> SetSalaryAsync(SetStaffSalaryRequest request, CancellationToken ct = default);
    Task PayAsync(PaySalaryRequest request, CancellationToken ct = default);
    Task DeductAsync(DeductSalaryRequest request, CancellationToken ct = default);

    /// Signed, dated Pay/Deduct history for one staff member.
    Task<IReadOnlyList<StaffSalaryTransactionDto>> GetTransactionsAsync(
        Guid staffId, DateOnly from, DateOnly to, CancellationToken ct = default);
}
