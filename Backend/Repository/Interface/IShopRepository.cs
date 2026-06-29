using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IShopRepository
{
    Task<List<Shop>> ListAsync(CancellationToken ct = default);
    Task<(List<Shop> Rows, long Total)> ListPagedAsync(int page, int pageSize, CancellationToken ct = default);
    Task<Shop?> GetAsync(Guid id, CancellationToken ct = default);
    Task<bool> ExistsAsync(Guid id, CancellationToken ct = default);
    Task<bool> ExistsByCodeAsync(string code, CancellationToken ct = default);
    Task<string> NextCodeAsync(CancellationToken ct = default);
    Task<Guid> CreateAsync(Shop shop, Guid userId, CancellationToken ct = default);
    Task<bool> UpdateAsync(Shop shop, Guid userId, CancellationToken ct = default);
    /// 19-Jun-2026 (client #15): single-column update for the AdminSettings
    /// per-shop GST toggle — avoids sending the whole shop payload.
    Task<bool> SetGstEnabledAsync(Guid id, bool enabled, Guid userId, CancellationToken ct = default);
    Task<bool> SoftDeleteAsync(Guid id, Guid userId, CancellationToken ct = default);
}
