using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IBillRepository
{
    Task<List<BillingProduct>> BillingProductsAsync(
        Guid shopId, string? search, int limit, CancellationToken ct = default);

    /// <param name="itemsJson">jsonb array of {"productId": uuid, "qty": int}</param>
    Task<BillCreated> CreateAsync(
        Guid shopId, Guid userId, string paymentMode, string itemsJson, string? notes,
        CancellationToken ct = default);

    Task CancelAsync(Guid billId, Guid shopId, Guid userId, string reason, CancellationToken ct = default);

    Task<List<BillListRow>> ListAsync(
        Guid shopId, string? search, string? status, DateOnly? from, DateOnly? to,
        int page, int pageSize, CancellationToken ct = default);

    Task<BillHeader?> GetAsync(Guid billId, Guid shopId, CancellationToken ct = default);

    Task<List<BillItemRow>> GetItemsAsync(Guid billId, CancellationToken ct = default);
}
