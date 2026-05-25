using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IStockRequestRepository
{
    Task<(List<StockRequest> Rows, long Total)> ListPagedAsync(
        Guid? shopId, Guid? inventoryId, string? status, string? search,
        int page, int pageSize, CancellationToken ct = default);

    Task<StockRequest?> GetAsync(Guid id, CancellationToken ct = default);

    Task<IReadOnlyList<CumulativePendingLine>> GetPendingCumulativeAsync(
        Guid? inventoryId, CancellationToken ct = default);

    Task<IReadOnlyList<ShopRequestCount>> GetCountByShopAsync(
        string? status, Guid? inventoryId, CancellationToken ct = default);

    Task<string> NextCodeAsync(CancellationToken ct = default);

    Task<Guid> CreateAsync(
        string code, Guid shopId, Guid inventoryId,
        DateTimeOffset editableUntil, string? notes,
        string itemsJson, Guid userId,
        CancellationToken ct = default);

    Task<bool> UpdateAsync(Guid id, string? notes, string itemsJson, Guid userId, CancellationToken ct = default);

    Task<bool> ApproveAsync(Guid id, Guid userId, CancellationToken ct = default);
    Task<bool> RejectAsync(Guid id, Guid userId, string reason, CancellationToken ct = default);
    Task<bool> RevokeAsync(Guid id, Guid userId, CancellationToken ct = default);
    Task<bool> DispatchAsync(Guid id, Guid userId, string dispatchedItemsJson, CancellationToken ct = default);
    Task<bool> ReceiveAsync(Guid id, Guid userId, CancellationToken ct = default);
    Task<bool> CancelAsync(Guid id, Guid userId, CancellationToken ct = default);

    // ── Shop drafts (single live draft per shop, status='Draft') ──
    Task<Guid> SaveShopDraftAsync(Guid shopId, Guid inventoryId, string? notes, string itemsJson, Guid userId, CancellationToken ct = default);
    Task<StockRequest?> GetShopDraftAsync(Guid shopId, CancellationToken ct = default);
    Task<bool> DeleteShopDraftAsync(Guid shopId, CancellationToken ct = default);

    // ── Inventory dispatch draft (WIP dispatch_qtys saved to draft_dispatched_qty) ──
    Task<bool> SaveDispatchDraftAsync(Guid id, Guid userId, string itemsJson, CancellationToken ct = default);

    /// Clear all draft_dispatched_qty on a request — inventory's discard path.
    Task<bool> ClearDispatchDraftAsync(Guid id, Guid userId, CancellationToken ct = default);

    /// List of Pending/Approved requests in this inventory that have at least
    /// one item with draft_dispatched_qty set. Header-shaped (no items JSON).
    Task<IReadOnlyList<StockRequest>> ListInventoryDispatchDraftsAsync(
        Guid? inventoryId, CancellationToken ct = default);
}
