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

    /// Per-shop-per-category operating expenses from shop_utility_expenses.
    /// Filter surface is narrower than the other reports — utilities aren't
    /// tied to godowns or product categories (see the SP header comment).
    Task<IReadOnlyList<AccountsUtilityRow>> GetUtilitiesAsync(
        DateOnly from, DateOnly to,
        Guid[]? shopIds,
        CancellationToken ct = default);

    /// Company-wide total of Inventory-role staff Pay/Deduct in range — no
    /// shop/inventory/category filter, godowns aren't scoped that way.
    Task<decimal> GetGodownExpensesAsync(
        DateOnly from, DateOnly to,
        CancellationToken ct = default);

    /// Per-inventory-per-category operational expenses from
    /// inventory_expenses (21-Jul-2026). Powers the "Inventory Expenses"
    /// line on the admin Accounts screen. Distinct from GetGodownExpensesAsync
    /// above (which is staff-salary tracking, a different feature).
    Task<IReadOnlyList<AccountsInventoryExpenseRow>> GetInventoryExpensesAsync(
        DateOnly from, DateOnly to,
        Guid[]? inventoryIds,
        CancellationToken ct = default);

    /// Per-inventory staff-salary breakdown (21-Jul-2026) — same source
    /// as GetGodownExpensesAsync's scalar total, but grouped by godown.
    /// Powers the "By Godown" panel on the admin Accounts screen.
    Task<IReadOnlyList<AccountsGodownExpenseByInventoryRow>> GetGodownExpensesByInventoryAsync(
        DateOnly from, DateOnly to,
        CancellationToken ct = default);
}
