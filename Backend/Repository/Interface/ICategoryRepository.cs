using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface ICategoryRepository
{
    Task<List<Category>> ListAsync(CancellationToken ct = default);
    Task<Category?> GetAsync(int id, CancellationToken ct = default);
    Task<bool> ExistsAsync(int id, CancellationToken ct = default);
    Task<bool> ExistsByNameAsync(string name, int? excludeId, CancellationToken ct = default);
    Task<int> CreateAsync(string name, bool active, Guid userId, CancellationToken ct = default);
    Task<bool> UpdateAsync(int id, string name, bool active, Guid userId, CancellationToken ct = default);
    Task<bool> SoftDeleteAsync(int id, Guid userId, CancellationToken ct = default);
}
