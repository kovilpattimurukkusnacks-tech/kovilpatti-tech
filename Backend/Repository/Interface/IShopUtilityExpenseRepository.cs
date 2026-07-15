using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IShopUtilityExpenseRepository
{
    /// Always scoped to one shop — callers pass the current ShopUser's own
    /// shop_id, never a client-supplied one. Optional date range filter.
    Task<List<ShopUtilityExpense>> ListAsync(
        Guid shopId, DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default);

    Task<ShopUtilityExpense?> GetAsync(Guid id, CancellationToken ct = default);

    /// Returns the full created row (via the SP's RETURNING clause) — no
    /// separate follow-up Get needed to build the response DTO.
    Task<ShopUtilityExpense> CreateAsync(
        Guid shopId, string category, decimal amount, string? note, DateOnly expenseDate,
        Guid userId, CancellationToken ct = default);

    /// Returns the full updated row, or null if no row matched (already
    /// deleted / wrong id) — same round-trip savings as CreateAsync.
    Task<ShopUtilityExpense?> UpdateAsync(
        Guid id, string category, decimal amount, string? note, DateOnly expenseDate,
        Guid userId, CancellationToken ct = default);

    Task<bool> SoftDeleteAsync(Guid id, Guid userId, CancellationToken ct = default);
}
