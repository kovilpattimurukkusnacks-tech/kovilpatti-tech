using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IInventoryRepository
{
    Task<List<Inventory>> ListAsync(CancellationToken ct = default);
    Task<Inventory?> GetAsync(Guid id, CancellationToken ct = default);
    Task<bool> ExistsAsync(Guid id, CancellationToken ct = default);
    Task<bool> ExistsByCodeAsync(string code, CancellationToken ct = default);
    Task<string> NextCodeAsync(CancellationToken ct = default);
    Task<Guid> CreateAsync(Inventory inventory, Guid userId, CancellationToken ct = default);
    Task<bool> UpdateAsync(Inventory inventory, Guid userId, CancellationToken ct = default);
    Task<bool> SoftDeleteAsync(Guid id, Guid userId, CancellationToken ct = default);
}
