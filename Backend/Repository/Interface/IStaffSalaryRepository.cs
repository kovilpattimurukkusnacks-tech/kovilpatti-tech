using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IStaffSalaryRepository
{
    /// One row per non-admin staff member, with paid/deducted/net for the
    /// given range. Admin-wide — no shop scoping (the caller is Admin).
    Task<List<StaffSalaryRow>> GetAllAsync(DateOnly from, DateOnly to, CancellationToken ct = default);

    /// Upserts the expected monthly amount for a staff member. Posts no
    /// ledger entry by itself.
    Task<StaffSalary> SetAsync(
        Guid staffId, decimal monthlyAmount, DateOnly effectiveFrom, Guid userId, CancellationToken ct = default);

    /// ShopUser-role staff Pay/Deduct — writes into shop_utility_expenses
    /// (category 'Staff Salary') so it's picked up by Accounts automatically.
    /// `amount` is signed: positive for Pay, negative for Deduct.
    Task<StaffSalaryShopTransaction> CreateShopTxnAsync(
        Guid shopId, Guid staffId, decimal amount, string? note, DateOnly txnDate, Guid userId,
        CancellationToken ct = default);

    /// Inventory-role staff Pay/Deduct — record-keeping only, never reaches
    /// Accounts. Same signed-amount convention as CreateShopTxnAsync.
    Task<StaffSalaryOtherTransaction> CreateOtherTxnAsync(
        Guid staffId, decimal amount, string? reason, string? note, DateOnly txnDate, Guid userId,
        CancellationToken ct = default);
}
