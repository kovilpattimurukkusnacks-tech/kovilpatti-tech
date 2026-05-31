using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface ICategoryRepository
{
    /// Flat list, root-first. Rows carry parent_id + path + depth so callers
    /// can render breadcrumbs / tree without extra round-trips.
    Task<List<Category>> ListAsync(CancellationToken ct = default);

    Task<Category?> GetAsync(int id, CancellationToken ct = default);
    Task<bool> ExistsAsync(int id, CancellationToken ct = default);

    /// Name uniqueness is scoped per-parent: "Spicy" can exist under both
    /// "Snacks" and "Drinks". `parentId = null` checks across roots.
    Task<bool> ExistsByNameAsync(string name, int? parentId, int? excludeId, CancellationToken ct = default);

    Task<int>  CreateAsync(string name, int? parentId, bool active, Guid userId, CancellationToken ct = default);
    Task<bool> UpdateAsync(int id, string name, int? parentId, bool active, Guid userId, CancellationToken ct = default);
    Task<bool> SoftDeleteAsync(int id, Guid userId, CancellationToken ct = default);
}
