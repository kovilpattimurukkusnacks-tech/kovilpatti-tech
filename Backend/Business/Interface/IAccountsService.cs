using KovilpattiSnacks.Business.DTOs.Accounts;

namespace KovilpattiSnacks.Business.Interface;

/// <summary>
/// Read-only Phase 3 accounts reporting. Every call validates the filter,
/// re-checks the caller is Admin (defence in depth — controller already
/// gates on the [Authorize(Roles = "Admin")] attribute), and dispatches to
/// the matching `fn_accounts_*` SP.
/// </summary>
public interface IAccountsService
{
    Task<AccountsSummaryDto> GetSummaryAsync(AccountsFilters filters, CancellationToken ct = default);
    Task<IReadOnlyList<AccountsTrendBucketDto>>     GetTrendAsync(AccountsFilters filters, CancellationToken ct = default);
    Task<IReadOnlyList<AccountsShopRowDto>>         GetByShopAsync(AccountsFilters filters, CancellationToken ct = default);
    Task<IReadOnlyList<AccountsCategoryRowDto>>     GetByCategoryAsync(AccountsFilters filters, CancellationToken ct = default);
    Task<IReadOnlyList<AccountsProductRowDto>>      GetTopProductsAsync(AccountsFilters filters, CancellationToken ct = default);
    Task<IReadOnlyList<AccountsAdjustmentRowDto>>   GetAdjustmentsAsync(AccountsFilters filters, CancellationToken ct = default);
    Task<AccountsInTransitDto>                      GetInTransitAsync(AccountsFilters filters, CancellationToken ct = default);
}
