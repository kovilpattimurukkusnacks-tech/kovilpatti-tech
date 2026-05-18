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
}
