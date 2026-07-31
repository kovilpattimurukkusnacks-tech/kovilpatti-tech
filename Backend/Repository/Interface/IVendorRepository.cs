using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IVendorRepository
{
    Task<List<Vendor>> ListAsync(CancellationToken ct = default);
    Task<(List<Vendor> Rows, long Total)> ListPagedAsync(
        int page, int pageSize, string? search = null, bool? active = null, CancellationToken ct = default);
    Task<Vendor?> GetAsync(Guid id, CancellationToken ct = default);
    Task<bool> ExistsAsync(Guid id, CancellationToken ct = default);
    Task<bool> ExistsByCodeAsync(string code, CancellationToken ct = default);
    Task<string> NextCodeAsync(CancellationToken ct = default);
    Task<Guid> CreateAsync(Vendor vendor, Guid userId, CancellationToken ct = default);
    Task<bool> UpdateAsync(Vendor vendor, Guid userId, CancellationToken ct = default);
    Task<bool> SoftDeleteAsync(Guid id, Guid userId, CancellationToken ct = default);
}
