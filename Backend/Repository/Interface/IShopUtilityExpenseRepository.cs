using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IShopUtilityExpenseRepository
{
    /// Always scoped to one shop — callers pass the current ShopUser's own
    /// shop_id, never a client-supplied one. Optional date range filter.
    Task<List<ShopUtilityExpense>> ListAsync(
        Guid shopId, DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default);

    Task<ShopUtilityExpense?> GetAsync(Guid id, CancellationToken ct = default);

    Task<Guid> CreateAsync(
        Guid shopId, string category, decimal amount, string? note, DateOnly expenseDate,
        Guid userId, CancellationToken ct = default);

    Task<bool> UpdateAsync(
        Guid id, string category, decimal amount, string? note, DateOnly expenseDate,
        Guid userId, CancellationToken ct = default);

    Task<bool> SoftDeleteAsync(Guid id, Guid userId, CancellationToken ct = default);
}
