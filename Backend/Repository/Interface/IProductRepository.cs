using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IProductRepository
{
    // 21-Jul-2026: includeInactive gates whether inactive (`active=false`)
    // products are returned. Default false → shop / inventory pickers see
    // only active rows; admin's management page passes true so it can
    // still surface + reactivate inactive rows. Every existing caller
    // takes the default (identical to pre-fix behaviour minus the actual
    // filter fix).
    Task<List<Product>> ListAsync(
        string? search, int? categoryId,
        bool includeInactive = false,
        CancellationToken ct = default);
    Task<(List<Product> Rows, long Total)> ListPagedAsync(
        string? search,
        int[]? categoryIds,
        string[]? types,
        int page,
        int pageSize,
        bool includeInactive = false,
        CancellationToken ct = default);
    Task<Product?> GetAsync(Guid id, CancellationToken ct = default);
    Task<bool> ExistsByCodeAsync(string code, CancellationToken ct = default);
    Task<string> NextCodeAsync(CancellationToken ct = default);
    Task<Guid> CreateAsync(Product product, Guid userId, CancellationToken ct = default);

    /// <summary>
    /// Atomically inserts a batch of products. Codes are generated server-side
    /// (one SP call instead of N round trips) and returned alongside the new
    /// ids so the caller can correlate. The SP runs inside a single transaction —
    /// any failure rolls back the whole batch.
    /// </summary>
    Task<List<(Guid Id, string Code)>> CreateBulkAsync(
        IReadOnlyList<Product> products, Guid userId, CancellationToken ct = default);

    Task<bool> UpdateAsync(Product product, Guid userId, CancellationToken ct = default);
    Task<bool> SoftDeleteAsync(Guid id, Guid userId, CancellationToken ct = default);
}
