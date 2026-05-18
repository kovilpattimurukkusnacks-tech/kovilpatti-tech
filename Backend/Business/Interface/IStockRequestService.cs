using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.StockRequests;

namespace KovilpattiSnacks.Business.Interface;

public interface IStockRequestService
{
    Task<PagedResult<StockRequestDto>> ListAsync(
        Guid? shopId, Guid? inventoryId, string? status, string? search,
        int page, int pageSize, CancellationToken ct = default);

    Task<StockRequestDto> GetAsync(Guid id, CancellationToken ct = default);

    /// Cumulative-pending workload, scoped by role: inventory user → own
    /// inventory; admin → may pass an inventoryId to scope, or NULL for
    /// tenant-wide totals; shop user → ForbiddenException.
    Task<IReadOnlyList<CumulativePendingLineDto>> GetPendingCumulativeAsync(
        Guid? inventoryId, CancellationToken ct = default);

    /// Per-shop request counts for a given status filter (NULL = all). Used
    /// by the list page's shop quick-filter chips. Inventory role scoped to
    /// own inventory; admin may pass inventoryId or NULL; shop user blocked.
    Task<IReadOnlyList<ShopRequestCountDto>> GetCountByShopAsync(
        string? status, Guid? inventoryId, CancellationToken ct = default);

    Task<StockRequestDto> CreateAsync(CreateStockRequestRequest request, CancellationToken ct = default);
    Task<StockRequestDto> UpdateAsync(Guid id, UpdateStockRequestRequest request, CancellationToken ct = default);

    Task<StockRequestDto> ApproveAsync(Guid id, CancellationToken ct = default);
    Task<StockRequestDto> RejectAsync(Guid id, RejectRequest request, CancellationToken ct = default);
    Task<StockRequestDto> RevokeAsync(Guid id, CancellationToken ct = default);
    Task<StockRequestDto> DispatchAsync(Guid id, DispatchRequest request, CancellationToken ct = default);
    Task<StockRequestDto> ReceiveAsync(Guid id, CancellationToken ct = default);
    Task<StockRequestDto> CancelAsync(Guid id, CancellationToken ct = default);
}
