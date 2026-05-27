using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.StockRequests;

namespace KovilpattiSnacks.Business.Interface;

public interface IStockRequestService
{
    Task<PagedResult<StockRequestDto>> ListAsync(
        Guid? shopId, Guid? inventoryId, string? status, string? search,
        int page, int pageSize,
        DateOnly? fromDate = null, DateOnly? toDate = null,
        CancellationToken ct = default);

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
        string? status, Guid? inventoryId,
        DateOnly? fromDate = null, DateOnly? toDate = null,
        CancellationToken ct = default);

    Task<StockRequestDto> CreateAsync(CreateStockRequestRequest request, CancellationToken ct = default);
    Task<StockRequestDto> UpdateAsync(Guid id, UpdateStockRequestRequest request, CancellationToken ct = default);

    Task<StockRequestDto> ApproveAsync(Guid id, CancellationToken ct = default);
    Task<StockRequestDto> RejectAsync(Guid id, RejectRequest request, CancellationToken ct = default);
    Task<StockRequestDto> RevokeAsync(Guid id, CancellationToken ct = default);
    Task<StockRequestDto> DispatchAsync(Guid id, DispatchRequest request, CancellationToken ct = default);
    Task<StockRequestDto> ReceiveAsync(Guid id, CancellationToken ct = default);
    Task<StockRequestDto> CancelAsync(Guid id, CancellationToken ct = default);

    // ── Shop drafts (ShopUser only) ──
    /// Save (or replace) the shop user's single live draft.
    Task<StockRequestDto> SaveShopDraftAsync(CreateStockRequestRequest request, CancellationToken ct = default);
    /// Get the shop user's current draft. Returns null when none exists.
    Task<StockRequestDto?> GetShopDraftAsync(CancellationToken ct = default);
    /// Discard the shop user's draft. Returns true if a draft was deleted.
    Task<bool> DeleteShopDraftAsync(CancellationToken ct = default);

    // ── Inventory dispatch draft (Inventory/Admin) ──
    /// Save WIP dispatch quantities without finalising. Pre-fills the dispatch
    /// screen when the user returns. Cleared when the dispatch is finalised.
    Task<StockRequestDto> SaveDispatchDraftAsync(Guid id, DispatchRequest request, CancellationToken ct = default);

    /// Discard the saved dispatch draft on a request (clears draft_dispatched_qty
    /// on every item). Returns the refreshed request DTO so caches stay in sync.
    Task<StockRequestDto> ClearDispatchDraftAsync(Guid id, CancellationToken ct = default);

    /// List of incoming requests (Pending/Approved) that have a saved
    /// dispatch draft on at least one item. Inventory role scoped to own
    /// inventory; admin may pass inventoryId or NULL for tenant-wide;
    /// shop user blocked.
    Task<IReadOnlyList<StockRequestDto>> ListInventoryDispatchDraftsAsync(
        Guid? inventoryId, CancellationToken ct = default);
}
