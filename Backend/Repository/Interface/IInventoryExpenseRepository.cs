using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IInventoryExpenseRepository
{
    /// Always scoped to one inventory — callers pass the current Inventory
    /// user's own inventory_id, never a client-supplied one. Optional date
    /// range filter.
    Task<List<InventoryExpense>> ListAsync(
        Guid inventoryId, DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default);

    Task<InventoryExpense?> GetAsync(Guid id, CancellationToken ct = default);

    /// Returns the full created row (via the SP's RETURNING clause) — no
    /// separate follow-up Get needed to build the response DTO.
    Task<InventoryExpense> CreateAsync(
        Guid inventoryId, string category, decimal amount, string? note, DateOnly expenseDate,
        Guid userId, CancellationToken ct = default);

    /// Returns the full updated row, or null if no row matched (already
    /// deleted / wrong id) — same round-trip savings as CreateAsync.
    Task<InventoryExpense?> UpdateAsync(
        Guid id, string category, decimal amount, string? note, DateOnly expenseDate,
        Guid userId, CancellationToken ct = default);

    Task<bool> SoftDeleteAsync(Guid id, Guid userId, CancellationToken ct = default);
}
