using KovilpattiSnacks.Repository.Entities.Accounts;

namespace KovilpattiSnacks.Repository.Interface;

/// <summary>
/// Phase 3 accounts reporting. Every method is read-only and dispatches to a
/// `fn_accounts_*` stored function. Filters are nullable: NULL or empty
/// arrays mean "no filter on this dimension".
/// </summary>
public interface IAccountsRepository
{
    Task<AccountsSummary> GetSummaryAsync(
        DateOnly from, DateOnly to,
        Guid[]? shopIds, Guid[]? inventoryIds, int[]? categoryIds,
        CancellationToken ct = default);

    Task<IReadOnlyList<AccountsTrendBucket>> GetTrendAsync(
        DateOnly from, DateOnly to, string grouping,
        Guid[]? shopIds, Guid[]? inventoryIds, int[]? categoryIds,
        CancellationToken ct = default);

    Task<IReadOnlyList<AccountsShopRow>> GetByShopAsync(
        DateOnly from, DateOnly to,
        Guid[]? shopIds, Guid[]? inventoryIds, int[]? categoryIds,
        CancellationToken ct = default);

    Task<IReadOnlyList<AccountsCategoryRow>> GetByCategoryAsync(
        DateOnly from, DateOnly to,
        Guid[]? shopIds, Guid[]? inventoryIds, int[]? categoryIds,
        CancellationToken ct = default);

    Task<IReadOnlyList<AccountsProductRow>> GetTopProductsAsync(
        DateOnly from, DateOnly to,
        Guid[]? shopIds, Guid[]? inventoryIds, int[]? categoryIds,
        int limit,
        CancellationToken ct = default);

    Task<IReadOnlyList<AccountsAdjustmentRow>> GetAdjustmentsAsync(
        DateOnly from, DateOnly to,
        Guid[]? shopIds, Guid[]? inventoryIds, int[]? categoryIds,
        CancellationToken ct = default);

    Task<AccountsInTransit> GetInTransitAsync(
        Guid[]? shopIds, Guid[]? inventoryIds,
        CancellationToken ct = default);
}
