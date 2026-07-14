using KovilpattiSnacks.Business.DTOs.ShopUtilityExpenses;

namespace KovilpattiSnacks.Business.Interface;

public interface IShopUtilityExpenseService
{
    /// Always scoped to the current ShopUser's own shop — there is no
    /// caller-supplied shop id anywhere in this interface.
    Task<IReadOnlyList<ShopUtilityExpenseDto>> ListAsync(
        DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default);

    Task<ShopUtilityExpenseDto> CreateAsync(CreateShopUtilityExpenseRequest request, CancellationToken ct = default);
    Task<ShopUtilityExpenseDto> UpdateAsync(Guid id, UpdateShopUtilityExpenseRequest request, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}
