using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IProductRepository
{
    Task<List<Product>> ListAsync(string? search, int? categoryId, CancellationToken ct = default);
    Task<(List<Product> Rows, long Total)> ListPagedAsync(string? search, int? categoryId, int page, int pageSize, CancellationToken ct = default);
    Task<Product?> GetAsync(Guid id, CancellationToken ct = default);
    Task<bool> ExistsByCodeAsync(string code, CancellationToken ct = default);
    Task<string> NextCodeAsync(CancellationToken ct = default);
    Task<Guid> CreateAsync(Product product, Guid userId, CancellationToken ct = default);
    Task<bool> UpdateAsync(Product product, Guid userId, CancellationToken ct = default);
    Task<bool> SoftDeleteAsync(Guid id, Guid userId, CancellationToken ct = default);
}
