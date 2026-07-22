using KovilpattiSnacks.Business.DTOs.InventoryExpenses;

namespace KovilpattiSnacks.Business.Interface;

public interface IInventoryExpenseService
{
    /// Always scoped to the current Inventory user's own godown — there is
    /// no caller-supplied inventory id anywhere in this interface.
    Task<IReadOnlyList<InventoryExpenseDto>> ListAsync(
        DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default);

    Task<InventoryExpenseDto> CreateAsync(CreateInventoryExpenseRequest request, CancellationToken ct = default);
    Task<InventoryExpenseDto> UpdateAsync(Guid id, UpdateInventoryExpenseRequest request, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}
