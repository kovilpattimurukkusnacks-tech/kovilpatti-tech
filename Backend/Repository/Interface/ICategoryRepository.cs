using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface ICategoryRepository
{
    Task<List<Category>> ListAsync(CancellationToken ct = default);
    Task<bool> ExistsAsync(int id, CancellationToken ct = default);
}
